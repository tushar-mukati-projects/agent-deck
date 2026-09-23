use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::anyhow;
use memchr::memmem::Finder;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::sessions::{claude_home, session_file};

const MAX_DIFF_BYTES: u64 = 2 * 1024 * 1024;
const DIFF_TIMEOUT: Duration = Duration::from_millis(300);
const EDIT_TOOLS: &[&str] = &["Write", "Edit", "MultiEdit", "NotebookEdit"];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
    pub edits: u32,
    pub backup: Option<String>,
}

#[derive(Default)]
struct Tracked {
    hash: Option<String>,
    edits: u32,
}

fn read_text(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_DIFF_BYTES {
        return None;
    }
    let bytes = fs::read(path).ok()?;
    (!bytes[..bytes.len().min(8192)].contains(&0)).then(|| String::from_utf8_lossy(&bytes).into_owned())
}

pub fn line_stats(before: &str, after: &str) -> (u32, u32) {
    if before == after {
        return (0, 0);
    }
    similar::TextDiff::configure()
        .timeout(DIFF_TIMEOUT)
        .diff_lines(before, after)
        .iter_all_changes()
        .fold((0, 0), |(add, del), change| match change.tag() {
            similar::ChangeTag::Insert => (add + 1, del),
            similar::ChangeTag::Delete => (add, del + 1),
            similar::ChangeTag::Equal => (add, del),
        })
}

fn record_snapshot(value: &Value, tracked: &mut BTreeMap<String, Tracked>) {
    let backups = value.pointer("/snapshot/trackedFileBackups").and_then(Value::as_object);
    for (path, backup) in backups.into_iter().flatten() {
        let entry = tracked.entry(path.clone()).or_default();
        if entry.hash.is_none() {
            entry.hash = backup
                .get("backupFileName")
                .and_then(Value::as_str)
                .and_then(|name| name.split('@').next())
                .map(str::to_string);
        }
    }
}

fn record_edits(value: &Value, tracked: &mut BTreeMap<String, Tracked>) {
    let blocks = value.pointer("/message/content").and_then(Value::as_array);
    for block in blocks.into_iter().flatten() {
        let is_edit = block.get("type").and_then(Value::as_str) == Some("tool_use")
            && block.get("name").and_then(Value::as_str).is_some_and(|n| EDIT_TOOLS.contains(&n));
        let target = block
            .get("input")
            .and_then(|i| i.get("file_path").or_else(|| i.get("notebook_path")))
            .and_then(Value::as_str);
        if let (true, Some(target)) = (is_edit, target) {
            tracked.entry(target.to_string()).or_default().edits += 1;
        }
    }
}

fn collect_tracked(jsonl: &Path) -> anyhow::Result<(String, BTreeMap<String, Tracked>)> {
    let snapshot = Finder::new(b"\"file-history-snapshot\"");
    let tool_use = Finder::new(b"\"tool_use\"");
    let cwd_key = Finder::new(b"\"cwd\"");
    let mut cwd = String::new();
    let mut tracked = BTreeMap::new();
    for line in BufReader::with_capacity(256 * 1024, fs::File::open(jsonl)?).split(b'\n').map_while(Result::ok) {
        let wants_cwd = cwd.is_empty() && cwd_key.find(&line).is_some();
        if snapshot.find(&line).is_none() && tool_use.find(&line).is_none() && !wants_cwd {
            continue;
        }
        let Ok(value) = serde_json::from_slice::<Value>(&line) else { continue };
        if cwd.is_empty() {
            if let Some(found) = value.get("cwd").and_then(Value::as_str) {
                cwd = found.to_string();
            }
        }
        match value.get("type").and_then(Value::as_str) {
            Some("file-history-snapshot") => record_snapshot(&value, &mut tracked),
            Some("assistant") => record_edits(&value, &mut tracked),
            _ => {}
        }
    }
    Ok((cwd, tracked))
}

fn resolve(cwd: &str, path: &str) -> PathBuf {
    let candidate = PathBuf::from(path);
    if candidate.is_absolute() || cwd.is_empty() {
        candidate
    } else {
        Path::new(cwd).join(candidate)
    }
}

fn describe(path: PathBuf, info: Tracked, backups_dir: &Path) -> Option<ChangedFile> {
    let backup = info.hash.map(|h| format!("{h}@v1")).filter(|name| backups_dir.join(name).is_file());
    let exists = path.is_file();
    let status = match (&backup, exists) {
        (None, false) => return None,
        (None, true) => "added",
        (Some(_), false) => "deleted",
        (Some(_), true) => "modified",
    };
    let before = backup.as_ref().and_then(|name| read_text(&backups_dir.join(name))).unwrap_or_default();
    let after = if exists { read_text(&path).unwrap_or_default() } else { String::new() };
    let status = if status == "modified" && before == after { "unchanged" } else { status };
    let (additions, deletions) = line_stats(&before, &after);
    Some(ChangedFile {
        path: path.to_string_lossy().to_string(),
        status: status.to_string(),
        additions,
        deletions,
        edits: info.edits,
        backup,
    })
}

pub fn session_changes(jsonl: &str) -> anyhow::Result<Vec<ChangedFile>> {
    let (path, session_id) = session_file(jsonl)?;
    let backups_dir = claude_home().join("file-history").join(&session_id);
    let (cwd, tracked) = collect_tracked(&path)?;

    let mut merged: BTreeMap<String, (PathBuf, Tracked)> = BTreeMap::new();
    for (raw, info) in tracked {
        let absolute = resolve(&cwd, &raw);
        let key = absolute.to_string_lossy().replace('/', "\\").to_lowercase();
        let entry = merged.entry(key).or_insert_with(|| (absolute, Tracked::default()));
        entry.1.edits += info.edits;
        entry.1.hash = entry.1.hash.take().or(info.hash);
    }

    let mut files: Vec<ChangedFile> =
        merged.into_values().collect::<Vec<_>>().into_par_iter().filter_map(|(p, t)| describe(p, t, &backups_dir)).collect();
    files.sort_by_key(|f| f.path.to_lowercase());
    Ok(files)
}

pub fn valid_backup_name(name: &str) -> bool {
    let Some((hash, version)) = name.split_once("@v") else { return false };
    !hash.is_empty()
        && hash.chars().all(|c| c.is_ascii_hexdigit())
        && !version.is_empty()
        && version.chars().all(|c| c.is_ascii_digit())
}

pub fn session_backup(jsonl: &str, backup: &str) -> anyhow::Result<String> {
    anyhow::ensure!(valid_backup_name(backup), "invalid backup name");
    let (_, session_id) = session_file(jsonl)?;
    read_text(&claude_home().join("file-history").join(session_id).join(backup)).ok_or_else(|| anyhow!("Backup not available"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_line_changes() {
        assert_eq!(line_stats("a\nb\nc\n", "a\nB\nc\nd\n"), (2, 1));
        assert_eq!(line_stats("same\n", "same\n"), (0, 0));
    }

    #[test]
    fn validates_backup_names() {
        assert!(valid_backup_name("01e3ec2df9d0f6df@v1"));
        assert!(!valid_backup_name("../secrets@v1"));
        assert!(!valid_backup_name("abc@v"));
    }

    #[test]
    #[ignore]
    fn probe_real_changes() {
        let sessions = crate::sessions::list_sessions();
        let session = sessions.iter().find(|s| s.cwd.contains("demo")).unwrap();
        let start = std::time::Instant::now();
        let files = session_changes(&session.file_path).unwrap();
        println!("{} files in {:?}", files.len(), start.elapsed());
    }
}
