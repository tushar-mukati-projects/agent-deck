use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::LazyLock,
};

use anyhow::Context;
use parking_lot::Mutex;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use crate::{
    codex,
    util::{canonical, is_session_id, mtime_ms},
};

const PROMPT_PREVIEW_CHARS: usize = 280;
const TRANSCRIPT_TEXT_CHARS: usize = 24_000;

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
    pub last_message_at: Option<String>,
    pub modified_ms: u64,
    pub prompt_count: u32,
    pub size: u64,
    pub version: Option<String>,
}

fn default_agent() -> String {
    "claude".into()
}

pub fn session_id_for(file_name: &str) -> String {
    let stem = file_name.trim_end_matches(".jsonl");
    codex::id_from_name(stem).filter(|_| stem.starts_with("rollout-")).unwrap_or(stem).to_string()
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
        let name = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        Self::with_ids(session_id_for(&name), path.to_string_lossy().to_string(), project_key, None)
    }

    pub(crate) fn with_ids(id: String, file_path: String, project_key: &str, distro: Option<String>) -> Self {
        Self {
            info: SessionInfo {
                id,
                agent: default_agent(),
                distro,
                file_path,
                project_key: project_key.to_string(),
                ..SessionInfo::default()
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

    fn note_prompt(&mut self, text: &str) {
        self.info.prompt_count += 1;
        let preview = truncate_chars(&collapse_whitespace(text), PROMPT_PREVIEW_CHARS);
        if self.info.first_prompt.is_none() {
            self.info.first_prompt = Some(preview.clone());
        }
        self.last_user_text = Some(preview);
    }

    fn feed_codex(&mut self, line: &str) {
        let Some(record) = codex::parse(line) else { return };
        self.info.agent = codex::AGENT.into();
        if let Some(ts) = record.timestamp {
            if self.info.started_at.is_none() {
                self.info.started_at = Some(ts.clone());
            }
            self.info.last_message_at = Some(ts);
        }
        match record.event {
            codex::Event::Meta { id, cwd, version, branch } => {
                if let Some(id) = id.filter(|i| is_session_id(i)) {
                    self.info.id = id;
                }
                if let Some(cwd) = cwd.filter(|c| !c.is_empty()) {
                    self.info.cwd = cwd;
                }
                self.info.version = version.or(self.info.version.take());
                self.info.git_branch = branch.or(self.info.git_branch.take());
            }
            codex::Event::Cwd(cwd) if self.info.cwd.is_empty() => self.info.cwd = cwd,
            codex::Event::User(text) if !is_system_text(&text) => self.note_prompt(&text),
            _ => {}
        }
    }

    pub(crate) fn feed(&mut self, line: &str) {
        let Ok(raw) = serde_json::from_str::<RawLine>(line) else { return };
        let kind = raw.kind.as_deref().unwrap_or("");
        if codex::is_codex_kind(kind) {
            self.feed_codex(line);
            return;
        }
        let info = &mut self.info;
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
                        self.note_prompt(&text);
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
        self.finish_with(mtime_ms(meta), meta.len())
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
    let codex = codex::session_files().into_iter().map(|(path, meta)| (path, String::new(), meta));
    let Ok(projects) = fs::read_dir(projects_dir()) else { return codex.collect() };
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
        .chain(codex)
        .collect()
}

pub fn list_sessions() -> Vec<SessionInfo> {
    let files = session_files();
    let work: Vec<_> = {
        let cache = CACHE.lock();
        files
            .iter()
            .filter_map(|(path, key, meta)| match cache.get(path) {
                Some(c) if c.modified_ms == mtime_ms(meta) && c.size == meta.len() => None,
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
            (path.clone(), CacheEntry { modified_ms: mtime_ms(meta), size: meta.len(), acc, info })
        })
        .collect();

    let mut cache = CACHE.lock();
    cache.extend(parsed);
    let present: HashSet<&PathBuf> = files.iter().map(|(p, _, _)| p).collect();
    cache.retain(|path, _| present.contains(path));

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

pub fn session_file(file_path: &str) -> anyhow::Result<(PathBuf, String)> {
    let path = canonical(Path::new(file_path))?;
    if codex::is_rollout(&path) {
        let root = canonical(&codex::sessions_dir())?;
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let session_id = session_id_for(&name);
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

pub fn transcript(file_path: &str) -> anyhow::Result<Vec<TranscriptItem>> {
    let (path, _) = session_file(file_path)?;
    let reader = BufReader::with_capacity(256 * 1024, fs::File::open(path)?);
    let lines = reader.split(b'\n').map_while(Result::ok).filter_map(|l| String::from_utf8(l).ok());
    Ok(transcript_from_lines(lines))
}

pub(crate) fn transcript_from_lines(lines: impl Iterator<Item = String>) -> Vec<TranscriptItem> {
    let mut items = Vec::new();
    for line_str in lines {
        let Ok(raw) = serde_json::from_str::<RawLine>(&line_str) else { continue };
        let kind = raw.kind.as_deref().unwrap_or("");
        if codex::is_codex_kind(kind) {
            items.extend(codex_item(&line_str));
            continue;
        }
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

fn codex_item(line: &str) -> Option<TranscriptItem> {
    let record = codex::parse(line)?;
    let item = |role: &str, kind: &str, text: String| TranscriptItem {
        role: role.into(),
        kind: kind.into(),
        text,
        timestamp: record.timestamp.clone(),
    };
    match record.event {
        codex::Event::User(text) if !is_system_text(&text) => {
            Some(item("user", "text", truncate_chars(&text, TRANSCRIPT_TEXT_CHARS)))
        }
        codex::Event::Assistant(text) if !text.trim().is_empty() => {
            Some(item("assistant", "text", truncate_chars(&text, TRANSCRIPT_TEXT_CHARS)))
        }
        codex::Event::Tool { name, detail } => Some(item(
            "assistant",
            "tool",
            match detail {
                Some(d) => format!("{name} · {}", truncate_chars(&collapse_whitespace(&d), 160)),
                None => name,
            },
        )),
        codex::Event::Patch(patch) => {
            let files: Vec<&str> = patch
                .lines()
                .filter_map(|l| {
                    ["*** Update File: ", "*** Add File: ", "*** Delete File: "].iter().find_map(|p| l.strip_prefix(p))
                })
                .collect();
            Some(item("assistant", "tool", format!("apply_patch · {}", truncate_chars(&files.join(", "), 160))))
        }
        _ => None,
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub session_id: String,
    pub role: String,
    pub snippet: String,
    pub timestamp: Option<String>,
}

const SEARCH_HITS_PER_SESSION: usize = 3;
const SNIPPET_RADIUS: usize = 90;

pub fn snippet_around(text: &str, needle_lower: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = chars.iter().flat_map(|c| c.to_lowercase()).collect();
    let needle: Vec<char> = needle_lower.chars().collect();
    if lower.len() != chars.len() || needle.is_empty() {
        return text.to_lowercase().contains(needle_lower).then(|| truncate_chars(&collapse_whitespace(text), SNIPPET_RADIUS * 2));
    }
    let index = lower.windows(needle.len()).position(|w| w == needle.as_slice())?;
    let start = index.saturating_sub(SNIPPET_RADIUS);
    let end = (index + needle.len() + SNIPPET_RADIUS).min(chars.len());
    let body = collapse_whitespace(&chars[start..end].iter().collect::<String>());
    Some(format!("{}{}{}", if start > 0 { "…" } else { "" }, body, if end < chars.len() { "…" } else { "" }))
}

fn search_file(path: &Path, needle_lower: &str) -> Vec<SearchHit> {
    let Ok(file) = fs::File::open(path) else { return Vec::new() };
    let session_id = session_id_for(&path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default());
    let finder = memchr::memmem::Finder::new(needle_lower.as_bytes());
    let mut hits = Vec::new();
    for line in BufReader::with_capacity(256 * 1024, file).split(b'\n').map_while(Result::ok) {
        if finder.find(&line.to_ascii_lowercase()).is_none() {
            continue;
        }
        let Ok(text) = std::str::from_utf8(&line) else { continue };
        let items = transcript_from_lines(std::iter::once(text.to_string()));
        for item in items.into_iter().filter(|i| i.kind == "text") {
            if let Some(snippet) = snippet_around(&item.text, needle_lower) {
                hits.push(SearchHit { session_id: session_id.clone(), role: item.role, snippet, timestamp: item.timestamp });
            }
        }
        if hits.len() >= SEARCH_HITS_PER_SESSION {
            break;
        }
    }
    hits.truncate(SEARCH_HITS_PER_SESSION);
    hits
}

pub fn search(query: &str) -> Vec<SearchHit> {
    let needle = query.trim().to_lowercase();
    if needle.chars().count() < 2 {
        return Vec::new();
    }
    let files = session_files();
    files.par_iter().flat_map_iter(|(path, _, _)| search_file(path, &needle)).collect()
}

pub fn delete_session(file_path: &str) -> anyhow::Result<()> {
    let (path, id) = session_file(file_path)?;
    if codex::is_rollout(&path) {
        trash::delete(&path).context("Couldn't move the session to the Recycle Bin")?;
        CACHE.lock().retain(|cached, _| dunce::canonicalize(cached).map(|c| c != path).unwrap_or(false));
        return Ok(());
    }
    anyhow::ensure!(
        !live_sessions().iter().any(|l| l.session_id == id),
        "This session is still running. Close it first."
    );
    let project = path.parent().context("invalid session path")?.to_path_buf();
    let home = claude_home();
    let targets: Vec<PathBuf> =
        [path.clone(), project.join(&id), home.join("file-history").join(&id), home.join("session-env").join(&id)]
            .into_iter()
            .filter(|p| p.exists())
            .collect();
    trash::delete_all(&targets).context("Couldn't move the session to the Recycle Bin")?;
    let _ = fs::remove_dir(&project);
    CACHE.lock().retain(|cached, _| dunce::canonicalize(cached).map(|c| c != path).unwrap_or(false));
    Ok(())
}

pub fn rename_session(file_path: &str, title: &str) -> anyhow::Result<()> {
    let (path, session_id) = session_file(file_path)?;
    anyhow::ensure!(!codex::is_rollout(&path), "Codex sessions are renamed inside Deck");
    let title = title.trim();
    anyhow::ensure!(!title.is_empty(), "Title can't be empty");
    let record = serde_json::json!({ "type": "custom-title", "customTitle": title, "sessionId": session_id });
    let mut file = fs::OpenOptions::new().read(true).append(true).open(&path)?;
    let needs_newline = file.metadata()?.len() > 0 && {
        let mut last = [0u8; 1];
        file.seek(SeekFrom::End(-1))?;
        file.read_exact(&mut last)?;
        last[0] != b'\n'
    };
    let line = format!("{}{record}\n", if needs_newline { "\n" } else { "" });
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
