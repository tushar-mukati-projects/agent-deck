use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::LazyLock,
    time::UNIX_EPOCH,
};

use anyhow::Context;
use parking_lot::Mutex;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

const PROMPT_PREVIEW_CHARS: usize = 280;
const TRANSCRIPT_TEXT_CHARS: usize = 24_000;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
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
    pub last_message_at: Option<String>,
    pub modified_ms: u64,
    pub prompt_count: u32,
    pub size: u64,
    pub version: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LiveSession {
    #[serde(default)]
    pub distro: Option<String>,
    pub session_id: String,
    pub pid: u32,
    pub cwd: Option<String>,
    pub status: Option<String>,
    pub kind: Option<String>,
    pub name: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptItem {
    pub role: String,
    pub kind: String,
    pub text: String,
    pub timestamp: Option<String>,
}

#[derive(Deserialize)]
struct RawLine<'a> {
    #[serde(rename = "type")]
    kind: Option<String>,
    cwd: Option<String>,
    #[serde(rename = "gitBranch")]
    git_branch: Option<String>,
    timestamp: Option<String>,
    #[serde(rename = "aiTitle")]
    ai_title: Option<String>,
    #[serde(rename = "customTitle")]
    custom_title: Option<String>,
    #[serde(rename = "lastPrompt")]
    last_prompt: Option<String>,
    #[serde(rename = "isMeta")]
    is_meta: Option<bool>,
    #[serde(rename = "isSidechain")]
    is_sidechain: Option<bool>,
    version: Option<String>,
    #[serde(borrow)]
    message: Option<RawMessage<'a>>,
}

#[derive(Deserialize)]
struct RawMessage<'a> {
    #[serde(borrow)]
    content: Option<&'a RawValue>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Content {
    Text(String),
    Blocks(Vec<Block>),
}

#[derive(Deserialize)]
struct Block {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
    name: Option<String>,
    input: Option<serde_json::Value>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Accumulator {
    info: SessionInfo,
    ai_title: Option<String>,
    last_user_text: Option<String>,
    offset: u64,
}

struct CacheEntry {
    modified_ms: u64,
    size: u64,
    acc: Accumulator,
    info: Option<SessionInfo>,
}

static CACHE: LazyLock<Mutex<HashMap<PathBuf, CacheEntry>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn claude_home() -> PathBuf {
    std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".claude"))
}

pub fn projects_dir() -> PathBuf {
    claude_home().join("projects")
}

pub fn live_dir() -> PathBuf {
    claude_home().join("sessions")
}

fn file_stamp(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn truncate_chars(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((idx, _)) => format!("{}…", &text[..idx]),
        None => text.to_string(),
    }
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_system_text(text: &str) -> bool {
    let trimmed = text.trim_start();
    trimmed.is_empty()
        || trimmed.starts_with('<')
        || trimmed.starts_with("Caveat:")
        || trimmed.starts_with("[Request interrupted")
        || trimmed.starts_with("This session is being continued")
}

fn user_prompt_text(content: &RawValue) -> Option<String> {
    let parsed: Content = serde_json::from_str(content.get()).ok()?;
    let text = match parsed {
        Content::Text(text) => text,
        Content::Blocks(blocks) => {
            if blocks.iter().any(|b| b.kind == "tool_result") {
                return None;
            }
            blocks
                .into_iter()
                .filter(|b| b.kind == "text")
                .filter_map(|b| b.text)
                .find(|t| !is_system_text(t))?
        }
    };
    if is_system_text(&text) {
        return None;
    }
    Some(text)
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

impl Accumulator {
    fn new(path: &Path, project_key: &str) -> Self {
        let id = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        Self::with_ids(id, path.to_string_lossy().to_string(), project_key, None)
    }

    pub(crate) fn with_ids(id: String, file_path: String, project_key: &str, distro: Option<String>) -> Self {
        Self {
            info: SessionInfo {
                id,
                distro,
                file_path,
                project_key: project_key.to_string(),
                cwd: String::new(),
                title: None,
                custom_title: None,
                first_prompt: None,
                last_prompt: None,
                git_branch: None,
                started_at: None,
                last_message_at: None,
                modified_ms: 0,
                prompt_count: 0,
                size: 0,
                version: None,
            },
            ai_title: None,
            last_user_text: None,
            offset: 0,
        }
    }

    pub(crate) fn offset(&self) -> u64 {
        self.offset
    }

    pub(crate) fn set_offset(&mut self, offset: u64) {
        self.offset = offset;
    }

    pub(crate) fn feed(&mut self, line: &str) {
        let Ok(raw) = serde_json::from_str::<RawLine>(line) else { return };
        let info = &mut self.info;
        let kind = raw.kind.as_deref().unwrap_or("");
        match kind {
            "custom-title" => info.custom_title = raw.custom_title.filter(|t| !t.trim().is_empty()),
            "ai-title" => self.ai_title = raw.ai_title.or(self.ai_title.take()),
            "last-prompt" => {
                if let Some(p) = raw.last_prompt.filter(|p| !p.trim().is_empty()) {
                    info.last_prompt = Some(truncate_chars(&collapse_whitespace(&p), PROMPT_PREVIEW_CHARS));
                }
            }
            "user" | "assistant" => {
                if raw.is_sidechain == Some(true) {
                    return;
                }
                if let Some(cwd) = raw.cwd.filter(|c| !c.is_empty()) {
                    if info.cwd.is_empty() {
                        info.cwd = cwd;
                    }
                }
                if raw.git_branch.is_some() {
                    info.git_branch = raw.git_branch;
                }
                if raw.version.is_some() {
                    info.version = raw.version;
                }
                if let Some(ts) = raw.timestamp {
                    if info.started_at.is_none() {
                        info.started_at = Some(ts.clone());
                    }
                    info.last_message_at = Some(ts);
                }
                if kind == "user" && raw.is_meta != Some(true) {
                    if let Some(text) = raw.message.and_then(|m| m.content).and_then(user_prompt_text) {
                        info.prompt_count += 1;
                        let preview = truncate_chars(&collapse_whitespace(&text), PROMPT_PREVIEW_CHARS);
                        if info.first_prompt.is_none() {
                            info.first_prompt = Some(preview.clone());
                        }
                        self.last_user_text = Some(preview);
                    }
                }
            }
            _ => {}
        }
    }

    fn read_from_offset(&mut self, path: &Path) {
        let Ok(mut file) = fs::File::open(path) else { return };
        if file.seek(SeekFrom::Start(self.offset)).is_err() {
            return;
        }
        let mut reader = BufReader::with_capacity(256 * 1024, file);
        let mut line = Vec::new();
        loop {
            line.clear();
            match reader.read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    if line.last() != Some(&b'\n') {
                        break;
                    }
                    self.offset += n as u64;
                    if let Ok(text) = std::str::from_utf8(&line) {
                        self.feed(text);
                    }
                }
            }
        }
    }

    fn finish(&self, meta: &fs::Metadata) -> Option<SessionInfo> {
        self.finish_with(file_stamp(meta), meta.len())
    }

    pub(crate) fn finish_with(&self, modified_ms: u64, size: u64) -> Option<SessionInfo> {
        let mut info = self.info.clone();
        if info.prompt_count == 0 && info.custom_title.is_none() {
            return None;
        }
        if info.cwd.is_empty() {
            info.cwd = decode_project_key(&info.project_key);
        }
        if info.last_prompt.is_none() {
            info.last_prompt = self.last_user_text.clone();
        }
        info.modified_ms = modified_ms;
        info.size = size;
        info.title = info
            .custom_title
            .clone()
            .or_else(|| self.ai_title.clone())
            .or_else(|| info.first_prompt.as_ref().map(|p| truncate_chars(p, 80)));
        Some(info)
    }
}

fn session_files() -> Vec<(PathBuf, String, fs::Metadata)> {
    let Ok(projects) = fs::read_dir(projects_dir()) else { return Vec::new() };
    projects
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .flat_map(|project| {
            let key = project.file_name().to_string_lossy().to_string();
            fs::read_dir(project.path())
                .into_iter()
                .flatten()
                .flatten()
                .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
                .filter_map(move |e| {
                    let meta = e.metadata().ok()?;
                    meta.is_file().then(|| (e.path(), key.clone(), meta))
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

pub fn list_sessions() -> Vec<SessionInfo> {
    let files = session_files();
    let work: Vec<_> = {
        let cache = CACHE.lock();
        files
            .iter()
            .filter_map(|(path, key, meta)| match cache.get(path) {
                Some(c) if c.modified_ms == file_stamp(meta) && c.size == meta.len() => None,
                Some(c) if meta.len() >= c.acc.offset => Some((path, meta, c.acc.clone())),
                _ => Some((path, meta, Accumulator::new(path, key))),
            })
            .collect()
    };

    let parsed: Vec<_> = work
        .into_par_iter()
        .map(|(path, meta, mut acc)| {
            acc.read_from_offset(path);
            let info = acc.finish(meta);
            (path.clone(), CacheEntry { modified_ms: file_stamp(meta), size: meta.len(), acc, info })
        })
        .collect();

    let mut cache = CACHE.lock();
    cache.extend(parsed);
    cache.retain(|path, _| files.iter().any(|(p, _, _)| p == path));

    let mut sessions: Vec<_> = cache.values().filter_map(|c| c.info.clone()).collect();
    sessions.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    sessions
}

#[cfg(windows)]
fn pid_alive(pid: u32) -> bool {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, STILL_ACTIVE},
        System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    };
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut code: u32 = 0;
        let ok = GetExitCodeProcess(handle, &mut code) != 0;
        CloseHandle(handle);
        ok && code == STILL_ACTIVE as u32
    }
}

#[cfg(not(windows))]
fn pid_alive(pid: u32) -> bool {
    Path::new(&format!("/proc/{pid}")).exists()
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveFile {
    pid: Option<u32>,
    session_id: Option<String>,
    cwd: Option<String>,
    status: Option<String>,
    kind: Option<String>,
    name: Option<String>,
}

pub fn live_sessions() -> Vec<LiveSession> {
    let Ok(entries) = fs::read_dir(live_dir()) else { return Vec::new() };
    entries
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| {
            let text = fs::read_to_string(e.path()).ok()?;
            let live: LiveFile = serde_json::from_str(&text).ok()?;
            let pid = live.pid?;
            pid_alive(pid).then_some(LiveSession {
                distro: None,
                session_id: live.session_id?,
                pid,
                cwd: live.cwd,
                status: live.status,
                kind: live.kind,
                name: live.name,
            })
        })
        .collect()
}

fn summarize_tool(name: &str, input: Option<&serde_json::Value>) -> String {
    let field = |key: &str| input.and_then(|i| i.get(key)).and_then(|v| v.as_str());
    let detail = field("description")
        .or_else(|| field("command"))
        .or_else(|| field("file_path"))
        .or_else(|| field("pattern"))
        .or_else(|| field("url"))
        .or_else(|| field("query"))
        .or_else(|| field("prompt"))
        .map(|d| truncate_chars(&collapse_whitespace(d), 160));
    match detail {
        Some(d) => format!("{name} · {d}"),
        None => name.to_string(),
    }
}

pub fn transcript(file_path: &str) -> anyhow::Result<Vec<TranscriptItem>> {
    let path = Path::new(file_path);
    anyhow::ensure!(
        path.starts_with(projects_dir()) && path.extension().is_some_and(|x| x == "jsonl"),
        "not a session file"
    );
    let reader = BufReader::with_capacity(256 * 1024, fs::File::open(path)?);
    let lines = reader.split(b'\n').map_while(Result::ok).filter_map(|l| String::from_utf8(l).ok());
    Ok(transcript_from_lines(lines))
}

pub(crate) fn transcript_from_lines(lines: impl Iterator<Item = String>) -> Vec<TranscriptItem> {
    let mut items = Vec::new();
    for line_str in lines {
        let Ok(raw) = serde_json::from_str::<RawLine>(&line_str) else { continue };
        let kind = raw.kind.as_deref().unwrap_or("");
        if raw.is_sidechain == Some(true) || !(kind == "user" || kind == "assistant") {
            continue;
        }
        let Some(content) = raw.message.and_then(|m| m.content) else { continue };
        let timestamp = raw.timestamp;

        if kind == "user" {
            if raw.is_meta == Some(true) {
                continue;
            }
            if let Some(text) = user_prompt_text(content) {
                items.push(TranscriptItem {
                    role: "user".into(),
                    kind: "text".into(),
                    text: truncate_chars(&text, TRANSCRIPT_TEXT_CHARS),
                    timestamp,
                });
            }
            continue;
        }

        let Ok(parsed) = serde_json::from_str::<Content>(content.get()) else { continue };
        let blocks = match parsed {
            Content::Text(text) => vec![Block { kind: "text".into(), text: Some(text), name: None, input: None }],
            Content::Blocks(blocks) => blocks,
        };
        for block in blocks {
            match block.kind.as_str() {
                "text" => {
                    if let Some(text) = block.text.filter(|t| !t.trim().is_empty()) {
                        items.push(TranscriptItem {
                            role: "assistant".into(),
                            kind: "text".into(),
                            text: truncate_chars(&text, TRANSCRIPT_TEXT_CHARS),
                            timestamp: timestamp.clone(),
                        });
                    }
                }
                "tool_use" => items.push(TranscriptItem {
                    role: "assistant".into(),
                    kind: "tool".into(),
                    text: summarize_tool(block.name.as_deref().unwrap_or("tool"), block.input.as_ref()),
                    timestamp: timestamp.clone(),
                }),
                _ => {}
            }
        }
    }
    items
}

pub fn delete_session(file_path: &str) -> anyhow::Result<()> {
    let path = Path::new(file_path);
    let project = path.parent().context("invalid session path")?;
    anyhow::ensure!(
        path.extension().is_some_and(|x| x == "jsonl")
            && project.parent() == Some(projects_dir().as_path())
            && path.is_file(),
        "not a Claude session file"
    );
    let id = path.file_stem().context("invalid session path")?.to_string_lossy().to_string();
    anyhow::ensure!(
        !live_sessions().iter().any(|l| l.session_id == id),
        "This session is still running. Close it first."
    );
    let home = claude_home();
    let targets: Vec<PathBuf> = [
        path.to_path_buf(),
        project.join(&id),
        home.join("file-history").join(&id),
        home.join("session-env").join(&id),
    ]
    .into_iter()
    .filter(|p| p.exists())
    .collect();
    trash::delete_all(&targets).context("Couldn't move the session to the Recycle Bin")?;
    let _ = fs::remove_dir(project);
    CACHE.lock().remove(path);
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
    #[ignore]
    fn probe_real_sessions() {
        let start = std::time::Instant::now();
        let sessions = list_sessions();
        let cold = start.elapsed();
        let start = std::time::Instant::now();
        let again = list_sessions();
        let warm = start.elapsed();
        println!("sessions={} cold={cold:?} warm={warm:?} again={}", sessions.len(), again.len());
        for s in sessions.iter().take(8) {
            println!("{} | {:?} | {} | prompts={} | branch={:?}", s.id, s.title, s.cwd, s.prompt_count, s.git_branch);
        }
        println!("live={:?}", live_sessions());
        let t = transcript(&sessions[0].file_path).unwrap();
        println!("transcript items={} first={:?}", t.len(), t.first().map(|i| &i.text[..i.text.len().min(80)]));
    }
}
