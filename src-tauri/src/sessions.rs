mod accumulator;
mod search;
mod transcript;

use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::LazyLock,
    time::Duration,
};

use anyhow::Context;
use parking_lot::Mutex;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

pub(crate) use accumulator::Accumulator;
pub(crate) use search::{begin_search, search, search_is_current, search_lines, Needle, SearchHit};
pub(crate) use transcript::{is_agent_id, subagent_transcript, transcript, transcript_from_lines, TranscriptPage};

use crate::{
    codex,
    util::{canonical, config_home, is_session_id, lenient_u64, mtime_ms, READ_BUFFER_BYTES},
};

const PARTIAL_LINE_WAIT: Duration = Duration::from_millis(300);
const SYSTEM_PREFIXES: &[&str] = &["Caveat:", "[Request interrupted", "This session is being continued"];
const SYSTEM_TAGS: &[&str] = &[
    "command-",
    "local-command-",
    "bash-",
    "task-notification",
    "system-reminder",
    "reconstructed-session",
    "user-prompt-submit-hook",
    "session-start-hook",
    "post-tool-use-hook",
    "new-diagnostics",
    "ide_",
    "environment_context",
    "user_instructions",
    "turn_aborted",
];

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    #[serde(default = "default_agent")]
    pub agent: String,
    pub distro: Option<String>,
    pub file_path: String,
    pub project_key: String,
    pub cwd: String,
    pub title: Option<String>,
    pub custom_title: Option<String>,
    pub first_prompt: Option<String>,
    pub last_prompt: Option<String>,
    pub git_branch: Option<String>,
    pub started_at: Option<String>,
    pub modified_ms: u64,
    pub prompt_count: u32,
    pub size: u64,
    pub version: Option<String>,
    #[serde(default)]
    pub recent_cwds: Vec<String>,
}


fn default_agent() -> String {
    "claude".into()
}

pub fn session_id_of(path: &str) -> String {
    let stem = path.rsplit(['/', '\\']).next().unwrap_or_default().trim_end_matches(".jsonl");
    codex::id_from_name(stem).filter(|_| stem.starts_with("rollout-")).unwrap_or(stem).to_string()
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LiveSession {
    pub distro: Option<String>,
    pub session_id: String,
    pub pid: u32,
    pub status: Option<String>,
    #[serde(default, deserialize_with = "lenient_u64")]
    pub started_at: Option<u64>,
}

struct CacheEntry {
    modified_ms: u64,
    size: u64,
    acc: Accumulator,
    info: Option<SessionInfo>,
}

static CACHE: LazyLock<Mutex<HashMap<String, CacheEntry>>> = LazyLock::new(Mutex::default);

pub fn claude_home() -> PathBuf {
    config_home("CLAUDE_CONFIG_DIR", ".claude")
}

pub fn projects_dir() -> PathBuf {
    claude_home().join("projects")
}

pub fn live_dir() -> PathBuf {
    claude_home().join("sessions")
}

fn truncate_chars(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((idx, _)) => format!("{}…", &text[..idx]),
        None => text.to_string(),
    }
}

fn preview(text: &str, max: usize) -> String {
    let mut out = String::new();
    let chars = text.split_whitespace().enumerate().flat_map(|(i, word)| (i > 0).then_some(' ').into_iter().chain(word.chars()));
    for (count, c) in chars.enumerate() {
        if count == max {
            out.push('…');
            break;
        }
        out.push(c);
    }
    out
}

fn is_system_text(text: &str) -> bool {
    let trimmed = text.trim_start();
    trimmed.is_empty()
        || SYSTEM_PREFIXES.iter().any(|p| trimmed.starts_with(p))
        || trimmed.strip_prefix('<').is_some_and(|rest| SYSTEM_TAGS.iter().any(|tag| rest.starts_with(tag)))
}

fn decode_project_key(key: &str) -> String {
    let mut chars = key.chars();
    match (chars.next(), chars.next(), chars.next()) {
        (Some(drive), Some('-'), Some('-')) if drive.is_ascii_alphabetic() => {
            format!("{}:\\{}", drive, key[3..].replace('-', "\\"))
        }
        _ => key.replace('-', "/"),
    }
}

pub(crate) fn ends_line(file: &mut fs::File, offset: u64) -> io::Result<bool> {
    if offset == 0 {
        return Ok(true);
    }
    let mut last = [0u8; 1];
    file.seek(SeekFrom::Start(offset - 1))?;
    file.read_exact(&mut last)?;
    Ok(last[0] == b'\n')
}

pub(crate) fn complete_lines(file: fs::File, start: u64, mut on_line: impl FnMut(&str, u64)) -> io::Result<()> {
    let mut reader = BufReader::with_capacity(READ_BUFFER_BYTES, file);
    reader.seek(SeekFrom::Start(start))?;
    let mut offset = start;
    let mut line = Vec::new();
    loop {
        line.clear();
        let n = reader.read_until(b'\n', &mut line)?;
        if n == 0 || line.last() != Some(&b'\n') {
            return Ok(());
        }
        offset += n as u64;
        on_line(std::str::from_utf8(&line).unwrap_or_default(), offset);
    }
}

fn session_files() -> Vec<(PathBuf, String, fs::Metadata)> {
    let mut files = Vec::new();
    for project in fs::read_dir(projects_dir()).into_iter().flatten().flatten() {
        if !project.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let key = project.file_name().to_string_lossy().to_string();
        for entry in fs::read_dir(project.path()).into_iter().flatten().flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|x| x == "jsonl") && entry.file_type().is_ok_and(|t| t.is_file()) {
                if let Ok(meta) = fs::metadata(&path) {
                    files.push((path, key.clone(), meta));
                }
            }
        }
    }
    files.extend(codex::session_files().into_iter().map(|(path, meta)| (path, String::new(), meta)));
    files
}

fn cache_key(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

pub fn list_sessions() -> Vec<SessionInfo> {
    let files = session_files();
    let work: Vec<_> = {
        let cache = CACHE.lock();
        files
            .iter()
            .filter_map(|(path, key, meta)| match cache.get(&cache_key(path)) {
                Some(c) if c.modified_ms == mtime_ms(meta) && c.size == meta.len() => None,
                Some(c) if meta.len() >= c.acc.offset() => Some((path, meta, c.acc.clone())),
                _ => Some((path, meta, Accumulator::new(path, key))),
            })
            .collect()
    };

    let parsed: Vec<_> = work
        .into_par_iter()
        .map(|(path, meta, mut acc)| {
            let complete = acc.read_from_offset(path).is_ok();
            let info = acc.finish_with(mtime_ms(meta), meta.len());
            let (modified_ms, size) = if complete { (mtime_ms(meta), meta.len()) } else { (0, acc.offset()) };
            (cache_key(path), CacheEntry { modified_ms, size, acc, info })
        })
        .collect();

    let mut cache = CACHE.lock();
    cache.extend(parsed);
    let present: HashSet<String> = files.iter().map(|(p, _, _)| cache_key(p)).collect();
    cache.retain(|path, _| present.contains(path));

    let mut sessions: Vec<_> = cache.values().filter_map(|c| c.info.clone()).collect();
    sessions.sort_by_key(|s| std::cmp::Reverse(s.modified_ms));
    sessions
}

pub fn session_file(file_path: &str) -> anyhow::Result<(PathBuf, String)> {
    let path = canonical(Path::new(file_path))?;
    if codex::is_rollout(&path) {
        let root = canonical(&codex::sessions_dir())?;
        let session_id = session_id_of(&path.to_string_lossy());
        anyhow::ensure!(path.starts_with(&root) && is_session_id(&session_id), "not a Codex session file");
        return Ok((path, session_id));
    }
    let projects = canonical(&projects_dir())?;
    let session_id = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    anyhow::ensure!(
        path.extension().is_some_and(|x| x == "jsonl")
            && path.parent().and_then(Path::parent) == Some(projects.as_path())
            && is_session_id(&session_id),
        "not a Claude session file"
    );
    Ok((path, session_id))
}

pub fn delete_session(file_path: &str) -> anyhow::Result<()> {
    let (path, id) = session_file(file_path)?;
    if codex::is_rollout(&path) {
        trash::delete(&path).context("Couldn't move the session to the Recycle Bin")?;
        CACHE.lock().remove(file_path);
        return Ok(());
    }
    anyhow::ensure!(!crate::process::live_sessions().iter().any(|l| l.session_id == id), "This session is still running. Close it first.");
    let project = path.parent().context("invalid session path")?.to_path_buf();
    let home = claude_home();
    let targets: Vec<PathBuf> =
        [path.clone(), project.join(&id), home.join("file-history").join(&id), home.join("session-env").join(&id)]
            .into_iter()
            .filter(|p| p.exists())
            .collect();
    trash::delete_all(&targets).context("Couldn't move the session to the Recycle Bin")?;
    let _ = fs::remove_dir(&project);
    CACHE.lock().remove(file_path);
    Ok(())
}

fn ends_with_newline(file: &mut fs::File) -> io::Result<bool> {
    let len = file.metadata()?.len();
    ends_line(file, len)
}

pub fn rename_session(file_path: &str, title: &str) -> anyhow::Result<()> {
    let (path, session_id) = session_file(file_path)?;
    anyhow::ensure!(!codex::is_rollout(&path), "Codex sessions are renamed inside Deck");
    let title = title.trim();
    anyhow::ensure!(!title.is_empty(), "Title can't be empty");
    let record = serde_json::json!({ "type": "custom-title", "customTitle": title, "sessionId": session_id });
    let mut file = fs::OpenOptions::new().read(true).append(true).open(&path)?;
    let mut complete = ends_with_newline(&mut file)?;
    if !complete {
        std::thread::sleep(PARTIAL_LINE_WAIT);
        complete = ends_with_newline(&mut file)?;
    }
    let line = format!("{}{record}\n", if complete { "" } else { "\n" });
    file.write_all(line.as_bytes())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_windows_project_keys() {
        assert_eq!(decode_project_key("C--Users-me"), r"C:\Users\me");
        assert_eq!(decode_project_key("-home-me"), "/home/me");
    }

    #[test]
    fn preview_matches_collapse_then_truncate() {
        let reference = |t: &str, n: usize| truncate_chars(&t.split_whitespace().collect::<Vec<_>>().join(" "), n);
        for text in ["", "  ", "abc", "abc def", "  lots   of\n\nspace  here  ", "héllo wörld ✓ done", "exactly"] {
            for max in [0, 1, 3, 4, 7, 8, 100] {
                assert_eq!(preview(text, max), reference(text, max), "{text:?} {max}");
            }
        }
    }

    #[test]
    fn treats_known_wrappers_as_system_text() {
        assert!(is_system_text("<command-name>/clear</command-name>"));
        assert!(is_system_text("  <task-notification>done</task-notification>"));
        assert!(is_system_text("Caveat: local"));
        assert!(!is_system_text("<div> isn't centered"));
        assert!(!is_system_text("<pasted_content>code</pasted_content> fix this"));
    }

}
