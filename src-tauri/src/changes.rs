use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{anyhow, Context};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::sessions::{claude_home, projects_dir};

const MAX_DIFF_BYTES: u64 = 2 * 1024 * 1024;
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

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub path: String,
    pub code: String,
}

#[derive(Default)]
struct Tracked {
    hash: Option<String>,
    edits: u32,
}

pub fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn validate_session_file(path: &Path) -> anyhow::Result<()> {
    let project = path.parent().context("invalid session path")?;
    anyhow::ensure!(
        path.extension().is_some_and(|x| x == "jsonl") && project.parent() == Some(projects_dir().as_path()),
        "not a Claude session file"
    );
    Ok(())
}

fn session_id(path: &Path) -> anyhow::Result<String> {
    Ok(path.file_stem().context("invalid session path")?.to_string_lossy().to_string())
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
    let diff = similar::TextDiff::from_lines(before, after);
    diff.iter_all_changes().fold((0, 0), |(add, del), change| match change.tag() {
        similar::ChangeTag::Insert => (add + 1, del),
        similar::ChangeTag::Delete => (add, del + 1),
        similar::ChangeTag::Equal => (add, del),
    })
}

fn collect_tracked(jsonl: &Path) -> anyhow::Result<(String, BTreeMap<String, Tracked>)> {
    let reader = BufReader::with_capacity(256 * 1024, fs::File::open(jsonl)?);
    let mut cwd = String::new();
    let mut tracked: BTreeMap<String, Tracked> = BTreeMap::new();
    for line in reader.split(b'\n').map_while(Result::ok) {
        let is_snapshot = memchr_contains(&line, b"\"file-history-snapshot\"");
        let is_tool = memchr_contains(&line, b"\"tool_use\"");
        let needs_cwd = cwd.is_empty() && memchr_contains(&line, b"\"cwd\"");
        if !(is_snapshot || is_tool || needs_cwd) {
            continue;
        }
        let Ok(value) = serde_json::from_slice::<Value>(&line) else { continue };
        if cwd.is_empty() {
            if let Some(found) = value.get("cwd").and_then(Value::as_str) {
                cwd = found.to_string();
            }
        }
        if value.get("type").and_then(Value::as_str) == Some("file-history-snapshot") {
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
        if value.get("type").and_then(Value::as_str) == Some("assistant") {
            let blocks = value.pointer("/message/content").and_then(Value::as_array);
            for block in blocks.into_iter().flatten() {
                let is_edit = block.get("type").and_then(Value::as_str) == Some("tool_use")
                    && block.get("name").and_then(Value::as_str).is_some_and(|n| EDIT_TOOLS.contains(&n));
                if !is_edit {
                    continue;
                }
                let input = block.get("input");
                let target = input
                    .and_then(|i| i.get("file_path").or_else(|| i.get("notebook_path")))
                    .and_then(Value::as_str);
                if let Some(target) = target {
                    tracked.entry(target.to_string()).or_default().edits += 1;
                }
            }
        }
    }
    Ok((cwd, tracked))
}

fn memchr_contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

fn resolve(cwd: &str, path: &str) -> PathBuf {
    let candidate = PathBuf::from(path);
    if candidate.is_absolute() || cwd.is_empty() {
        candidate
    } else {
        Path::new(cwd).join(candidate)
    }
}

fn normalized_key(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_lowercase()
}

pub fn session_changes(jsonl: &str) -> anyhow::Result<Vec<ChangedFile>> {
    let jsonl_path = Path::new(jsonl);
    validate_session_file(jsonl_path)?;
    let backups_dir = claude_home().join("file-history").join(session_id(jsonl_path)?);
    let (cwd, tracked) = collect_tracked(jsonl_path)?;

    let mut merged: BTreeMap<String, (PathBuf, Tracked)> = BTreeMap::new();
    for (raw, info) in tracked {
        let absolute = resolve(&cwd, &raw);
        let entry = merged.entry(normalized_key(&absolute)).or_insert_with(|| (absolute, Tracked::default()));
        entry.1.edits += info.edits;
        if entry.1.hash.is_none() {
            entry.1.hash = info.hash;
        }
    }

    let mut files: Vec<ChangedFile> = merged
        .into_values()
        .filter_map(|(path, info)| {
            let backup = info.hash.map(|h| format!("{h}@v1")).filter(|name| backups_dir.join(name).is_file());
            let before = backup.as_ref().and_then(|name| read_text(&backups_dir.join(name)));
            let exists = path.is_file();
            let after = exists.then(|| read_text(&path)).flatten();
            let status = match (&backup, exists) {
                (None, false) => return None,
                (None, true) => "added",
                (Some(_), false) => "deleted",
                (Some(_), true) if before.is_some() && before == after => "unchanged",
                (Some(_), true) => "modified",
            };
            let (additions, deletions) = line_stats(before.as_deref().unwrap_or(""), after.as_deref().unwrap_or(""));
            Some(ChangedFile {
                path: path.to_string_lossy().to_string(),
                status: status.to_string(),
                additions,
                deletions,
                edits: info.edits,
                backup,
            })
        })
        .collect();
    files.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(files)
}

pub fn session_backup(jsonl: &str, backup: &str) -> anyhow::Result<String> {
    let jsonl_path = Path::new(jsonl);
    validate_session_file(jsonl_path)?;
    anyhow::ensure!(valid_backup_name(backup), "invalid backup name");
    let path = claude_home().join("file-history").join(session_id(jsonl_path)?).join(backup);
    read_text(&path).ok_or_else(|| anyhow!("Backup not available"))
}

pub fn valid_backup_name(name: &str) -> bool {
    let Some((hash, version)) = name.split_once("@v") else { return false };
    !hash.is_empty()
        && hash.chars().all(|c| c.is_ascii_hexdigit())
        && !version.is_empty()
        && version.chars().all(|c| c.is_ascii_digit())
}

fn git(root: &str, args: &[&str]) -> anyhow::Result<Vec<u8>> {
    let output = hidden(Command::new("git").arg("-C").arg(root).args(args)).output().context("git is not available")?;
    anyhow::ensure!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr).trim());
    Ok(output.stdout)
}

pub fn parse_porcelain(output: &[u8], root_join: impl Fn(&str) -> String) -> Vec<GitChange> {
    let mut changes = Vec::new();
    let mut entries = output.split(|b| *b == 0).filter(|e| !e.is_empty());
    while let Some(entry) = entries.next() {
        let text = String::from_utf8_lossy(entry);
        if text.len() < 4 {
            continue;
        }
        let code = text[..2].trim().to_string();
        let path = text[3..].to_string();
        if code.starts_with('R') || code.starts_with('C') {
            entries.next();
        }
        changes.push(GitChange { path: root_join(&path), code: if code.is_empty() { "M".into() } else { code } });
    }
    changes
}

pub fn git_status(root: &str) -> anyhow::Result<Vec<GitChange>> {
    let top = String::from_utf8(git(root, &["rev-parse", "--show-toplevel"])?)?.trim().replace('/', "\\");
    let output = git(root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    Ok(parse_porcelain(&output, |rel| format!("{}\\{}", top, rel.replace('/', "\\"))))
}

pub fn git_head_file(path: &str) -> anyhow::Result<String> {
    let file = Path::new(path);
    let dir = file.parent().context("invalid path")?.to_string_lossy().to_string();
    let name = file.file_name().context("invalid path")?.to_string_lossy().to_string();
    let bytes = git(&dir, &["show", &format!("HEAD:./{name}")])?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub fn rename_session(jsonl: &str, title: &str) -> anyhow::Result<()> {
    let path = Path::new(jsonl);
    validate_session_file(path)?;
    let title = title.trim();
    anyhow::ensure!(!title.is_empty(), "Title can't be empty");
    let record = serde_json::json!({ "type": "custom-title", "customTitle": title, "sessionId": session_id(path)? });
    let needs_newline = fs::read(path).map(|b| b.last().is_some_and(|c| *c != b'\n')).unwrap_or(false);
    let mut file = fs::OpenOptions::new().append(true).open(path)?;
    if needs_newline {
        file.write_all(b"\n")?;
    }
    writeln!(file, "{record}")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_line_changes() {
        assert_eq!(line_stats("a\nb\nc\n", "a\nB\nc\nd\n"), (2, 1));
    }

    #[test]
    fn validates_backup_names() {
        assert!(valid_backup_name("01e3ec2df9d0f6df@v1"));
        assert!(!valid_backup_name("../secrets@v1"));
        assert!(!valid_backup_name("abc@v"));
    }

    #[test]
    fn parses_porcelain_with_renames() {
        let out = b" M src/a.ts\0R  new.ts\0old.ts\0?? notes.md\0";
        let changes = parse_porcelain(out, |p| p.to_string());
        let summary: Vec<_> = changes.iter().map(|c| (c.code.as_str(), c.path.as_str())).collect();
        assert_eq!(summary, vec![("M", "src/a.ts"), ("R", "new.ts"), ("??", "notes.md")]);
    }

    #[test]
    #[ignore]
    fn probe_real_changes() {
        let sessions = crate::sessions::list_sessions();
        let session = sessions.iter().find(|s| s.cwd.contains("demo")).unwrap();
        let files = session_changes(&session.file_path).unwrap();
        println!("{} files", files.len());
        for f in files.iter().take(8) {
            println!("{} {} +{} -{} edits={} backup={:?}", f.status, f.path, f.additions, f.deletions, f.edits, f.backup);
        }
    }
}
