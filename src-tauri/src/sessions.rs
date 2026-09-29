use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        LazyLock,
    },
    time::Duration,
};

use aho_corasick::AhoCorasick;
use anyhow::Context;
use parking_lot::Mutex;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use crate::{
    codex,
    util::{canonical, is_session_id, lenient, lenient_bool, lenient_u64, mtime_ms},
};

const PROMPT_PREVIEW_CHARS: usize = 280;
const TITLE_CHARS: usize = 80;
const TOOL_DETAIL_CHARS: usize = 160;
pub const TRANSCRIPT_TEXT_CHARS: usize = 24_000;
const TOOL_RESULT: &[u8] = br#""type":"tool_result""#;
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
    pub last_message_at: Option<String>,
    pub modified_ms: u64,
    pub prompt_count: u32,
    pub size: u64,
    pub version: Option<String>,
    #[serde(default)]
    pub recent_cwds: Vec<String>,
}

const RECENT_CWDS: usize = 6;

fn default_agent() -> String {
    "claude".into()
}

pub fn session_id_for(file_name: &str) -> String {
    let stem = file_name.trim_end_matches(".jsonl");
    codex::id_from_name(stem).filter(|_| stem.starts_with("rollout-")).unwrap_or(stem).to_string()
}

fn file_name_of(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or_default()
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
    #[serde(default, deserialize_with = "lenient_u64")]
    pub started_at: Option<u64>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptItem {
    pub role: String,
    pub kind: String,
    pub text: String,
    pub timestamp: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPage {
    pub items: Vec<TranscriptItem>,
    pub offset: u64,
    pub reset: bool,
}

#[derive(Deserialize)]
struct RawLine<'a> {
    #[serde(rename = "type", default, deserialize_with = "lenient")]
    kind: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    cwd: Option<String>,
    #[serde(rename = "gitBranch", default, deserialize_with = "lenient")]
    git_branch: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    timestamp: Option<String>,
    #[serde(rename = "aiTitle", default, deserialize_with = "lenient")]
    ai_title: Option<String>,
    #[serde(rename = "customTitle", default, deserialize_with = "lenient")]
    custom_title: Option<String>,
    #[serde(rename = "lastPrompt", default, deserialize_with = "lenient")]
    last_prompt: Option<String>,
    #[serde(rename = "isMeta", default, deserialize_with = "lenient_bool")]
    is_meta: bool,
    #[serde(rename = "isSidechain", default, deserialize_with = "lenient_bool")]
    is_sidechain: bool,
    #[serde(default, deserialize_with = "lenient")]
    version: Option<String>,
    #[serde(borrow, default)]
    message: Option<RawMessage<'a>>,
    #[serde(borrow, default)]
    payload: Option<&'a RawValue>,
}

#[derive(Deserialize)]
struct RawMessage<'a> {
    #[serde(borrow, default)]
    content: Option<&'a RawValue>,
}

enum Parsed<'a> {
    Claude(RawLine<'a>),
    Codex(codex::Record),
}

fn parse_line(line: &str, detailed: bool) -> Option<Parsed<'_>> {
    let raw: RawLine = serde_json::from_str(line).ok()?;
    match raw.kind.as_deref() {
        Some(kind) if codex::is_codex_kind(kind) => codex::from_parts(kind, raw.timestamp, raw.payload, detailed).map(Parsed::Codex),
        _ => Some(Parsed::Claude(raw)),
    }
}

enum Content<'a> {
    Text(String),
    Blocks(Vec<Block<'a>>),
}

#[derive(Deserialize)]
struct Block<'a> {
    #[serde(rename = "type", default, deserialize_with = "lenient")]
    kind: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    text: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    name: Option<String>,
    #[serde(borrow, default)]
    input: Option<&'a RawValue>,
}

impl Block<'_> {
    fn is(&self, kind: &str) -> bool {
        self.kind.as_deref() == Some(kind)
    }
}

fn parse_content(raw: &RawValue) -> Option<Content<'_>> {
    let text = raw.get();
    match text.as_bytes().first()? {
        b'"' => serde_json::from_str(text).ok().map(Content::Text),
        b'[' => serde_json::from_str(text).ok().map(Content::Blocks),
        _ => None,
    }
}

#[derive(Deserialize, Default)]
struct ToolInput {
    #[serde(default, deserialize_with = "lenient")]
    description: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    command: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    file_path: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pattern: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    url: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    query: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    prompt: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Accumulator {
    info: SessionInfo,
    ai_title: Option<String>,
    last_user_text: Option<String>,
    offset: u64,
    #[serde(default)]
    seen_meta: bool,
}

struct CacheEntry {
    modified_ms: u64,
    size: u64,
    acc: Accumulator,
    info: Option<SessionInfo>,
}

static CACHE: LazyLock<Mutex<HashMap<String, CacheEntry>>> = LazyLock::new(Mutex::default);
static SEARCH_GENERATION: AtomicU64 = AtomicU64::new(0);

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

pub fn preview(text: &str, max: usize) -> String {
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

pub fn is_system_text(text: &str) -> bool {
    let trimmed = text.trim_start();
    trimmed.is_empty()
        || SYSTEM_PREFIXES.iter().any(|p| trimmed.starts_with(p))
        || trimmed.strip_prefix('<').is_some_and(|rest| SYSTEM_TAGS.iter().any(|tag| rest.starts_with(tag)))
}

fn user_prompt_text(content: &RawValue) -> Option<String> {
    if content.get().starts_with('[') && memchr::memmem::find(content.get().as_bytes(), TOOL_RESULT).is_some() {
        return None;
    }
    let text = match parse_content(content)? {
        Content::Text(text) => text,
        Content::Blocks(blocks) => {
            if blocks.iter().any(|b| b.is("tool_result")) {
                return None;
            }
            blocks.into_iter().filter(|b| b.is("text")).filter_map(|b| b.text).find(|t| !is_system_text(t))?
        }
    };
    (!is_system_text(&text)).then_some(text)
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
    let mut reader = BufReader::with_capacity(256 * 1024, file);
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
            seen_meta: false,
        }
    }

    fn restarted(&self) -> Self {
        let info = &self.info;
        Self::with_ids(session_id_for(file_name_of(&info.file_path)), info.file_path.clone(), &info.project_key, info.distro.clone())
    }

    pub(crate) fn offset(&self) -> u64 {
        self.offset
    }

    pub(crate) fn set_offset(&mut self, offset: u64) {
        self.offset = offset;
    }

    fn note_prompt(&mut self, text: &str) {
        self.info.prompt_count += 1;
        let preview = preview(text, PROMPT_PREVIEW_CHARS);
        if self.info.first_prompt.is_none() {
            self.info.first_prompt = Some(preview.clone());
        }
        self.last_user_text = Some(preview);
    }

    fn note_cwd(&mut self, cwd: String) {
        if cwd.is_empty() {
            return;
        }
        if self.info.cwd.is_empty() {
            self.info.cwd = cwd.clone();
        }
        let recent = &mut self.info.recent_cwds;
        if recent.first() == Some(&cwd) {
            return;
        }
        recent.retain(|c| *c != cwd);
        recent.insert(0, cwd);
        recent.truncate(RECENT_CWDS);
    }

    fn note_time(&mut self, timestamp: Option<String>) {
        if let Some(ts) = timestamp {
            if self.info.started_at.is_none() {
                self.info.started_at = Some(ts.clone());
            }
            self.info.last_message_at = Some(ts);
        }
    }

    fn feed_codex(&mut self, record: codex::Record) {
        self.info.agent = codex::AGENT.into();
        self.note_time(record.timestamp);
        match record.event {
            codex::Event::Meta { id, cwd, version, branch, started } => {
                if !std::mem::replace(&mut self.seen_meta, true) {
                    if let Some(started) = started {
                        self.info.started_at = Some(started);
                    }
                }
                if let Some(id) = id.filter(|i| is_session_id(i) && !is_session_id(&self.info.id)) {
                    self.info.id = id;
                }
                if let Some(cwd) = cwd {
                    self.note_cwd(cwd);
                }
                self.info.version = version.or(self.info.version.take());
                self.info.git_branch = branch.filter(|b| !b.is_empty()).or(self.info.git_branch.take());
            }
            codex::Event::Cwd(cwd) => self.note_cwd(cwd),
            codex::Event::User(text) if !is_system_text(&text) => self.note_prompt(&text),
            _ => {}
        }
    }

    fn feed_claude(&mut self, raw: RawLine) {
        let kind = raw.kind.as_deref().unwrap_or("");
        match kind {
            "custom-title" => self.info.custom_title = raw.custom_title.filter(|t| !t.trim().is_empty()),
            "ai-title" => self.ai_title = raw.ai_title.or(self.ai_title.take()),
            "last-prompt" => {
                if let Some(p) = raw.last_prompt.filter(|p| !p.trim().is_empty()) {
                    self.info.last_prompt = Some(preview(&p, PROMPT_PREVIEW_CHARS));
                }
            }
            "user" | "assistant" if !raw.is_sidechain => {
                let is_user = kind == "user";
                if let Some(cwd) = raw.cwd {
                    self.note_cwd(cwd);
                }
                if let Some(branch) = raw.git_branch {
                    self.info.git_branch = Some(branch).filter(|b| !b.is_empty());
                }
                if raw.version.is_some() {
                    self.info.version = raw.version;
                }
                self.note_time(raw.timestamp);
                if is_user && !raw.is_meta {
                    if let Some(text) = raw.message.and_then(|m| m.content).and_then(user_prompt_text) {
                        self.note_prompt(&text);
                    }
                }
            }
            _ => {}
        }
    }

    pub(crate) fn feed(&mut self, line: &str) {
        match parse_line(line, false) {
            Some(Parsed::Codex(record)) => self.feed_codex(record),
            Some(Parsed::Claude(raw)) => self.feed_claude(raw),
            None => {}
        }
    }

    fn read_from_offset(&mut self, path: &Path) -> io::Result<()> {
        let mut file = fs::File::open(path)?;
        if !ends_line(&mut file, self.offset)? {
            *self = self.restarted();
        }
        complete_lines(file, self.offset, |line, end| {
            self.feed(line);
            self.offset = end;
        })
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
            .or_else(|| info.first_prompt.as_ref().map(|p| truncate_chars(p, TITLE_CHARS)));
        Some(info)
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
                Some(c) if meta.len() >= c.acc.offset => Some((path, meta, c.acc.clone())),
                _ => Some((path, meta, Accumulator::new(path, key))),
            })
            .collect()
    };

    let parsed: Vec<_> = work
        .into_par_iter()
        .map(|(path, meta, mut acc)| {
            let complete = acc.read_from_offset(path).is_ok();
            let info = acc.finish_with(mtime_ms(meta), meta.len());
            let (modified_ms, size) = if complete { (mtime_ms(meta), meta.len()) } else { (0, acc.offset) };
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

#[cfg(windows)]
fn is_agent_process(pid: u32) -> bool {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, STILL_ACTIVE},
        System::Threading::{GetExitCodeProcess, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION},
    };
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut code: u32 = 0;
        let alive = GetExitCodeProcess(handle, &mut code) != 0 && code == STILL_ACTIVE as u32;
        let mut buffer = [0u16; 1024];
        let mut len = buffer.len() as u32;
        let named = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut len) != 0;
        CloseHandle(handle);
        let image = String::from_utf16_lossy(&buffer[..len as usize]).to_lowercase();
        let name = image.rsplit('\\').next().unwrap_or_default();
        alive && (!named || ["claude", "node", "bun"].iter().any(|n| name.contains(n)))
    }
}

#[cfg(not(windows))]
fn is_agent_process(pid: u32) -> bool {
    fs::read(format!("/proc/{pid}/cmdline")).is_ok_and(|cmd| memchr::memmem::find(&cmd, b"claude").is_some())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveFile {
    pid: Option<u32>,
    #[serde(default, deserialize_with = "lenient")]
    session_id: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    cwd: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    status: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    kind: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    name: Option<String>,
    #[serde(default, deserialize_with = "lenient_u64")]
    started_at: Option<u64>,
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
            is_agent_process(pid).then_some(LiveSession {
                distro: None,
                session_id: live.session_id?,
                pid,
                cwd: live.cwd,
                status: live.status,
                kind: live.kind,
                name: live.name,
                started_at: live.started_at,
            })
        })
        .collect()
}

fn summarize_tool(name: &str, input: Option<&RawValue>) -> String {
    let input: ToolInput = input.and_then(|i| serde_json::from_str(i.get()).ok()).unwrap_or_default();
    let detail = input
        .description
        .or(input.command)
        .or(input.file_path)
        .or(input.pattern)
        .or(input.url)
        .or(input.query)
        .or(input.prompt);
    match detail {
        Some(d) => format!("{name} · {}", preview(&d, TOOL_DETAIL_CHARS)),
        None => name.to_string(),
    }
}

pub fn session_file(file_path: &str) -> anyhow::Result<(PathBuf, String)> {
    let path = canonical(Path::new(file_path))?;
    if codex::is_rollout(&path) {
        let root = canonical(&codex::sessions_dir())?;
        let session_id = session_id_for(&path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
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

fn item(role: &str, kind: &str, text: String, timestamp: Option<String>) -> TranscriptItem {
    TranscriptItem { role: role.into(), kind: kind.into(), text, timestamp }
}

fn claude_items(raw: RawLine, out: &mut Vec<TranscriptItem>) {
    let kind = raw.kind.as_deref().unwrap_or("");
    if raw.is_sidechain || !(kind == "user" || kind == "assistant") {
        return;
    }
    if kind == "user" && raw.is_meta {
        return;
    }
    let Some(content) = raw.message.and_then(|m| m.content) else { return };
    let timestamp = raw.timestamp;
    if kind == "user" {
        if let Some(text) = user_prompt_text(content) {
            out.push(item("user", "text", truncate_chars(&text, TRANSCRIPT_TEXT_CHARS), timestamp));
        }
        return;
    }
    let blocks = match parse_content(content) {
        Some(Content::Text(text)) => vec![Block { kind: Some("text".into()), text: Some(text), name: None, input: None }],
        Some(Content::Blocks(blocks)) => blocks,
        None => return,
    };
    for block in blocks {
        if block.is("text") {
            if let Some(text) = block.text.filter(|t| !t.trim().is_empty()) {
                out.push(item("assistant", "text", truncate_chars(&text, TRANSCRIPT_TEXT_CHARS), timestamp.clone()));
            }
        } else if block.is("tool_use") {
            let summary = summarize_tool(block.name.as_deref().unwrap_or("tool"), block.input);
            out.push(item("assistant", "tool", summary, timestamp.clone()));
        }
    }
}

fn codex_item(record: codex::Record) -> Option<TranscriptItem> {
    let timestamp = record.timestamp;
    Some(match record.event {
        codex::Event::User(text) if !is_system_text(&text) => item("user", "text", truncate_chars(&text, TRANSCRIPT_TEXT_CHARS), timestamp),
        codex::Event::Assistant(text) if !text.trim().is_empty() => {
            item("assistant", "text", truncate_chars(&text, TRANSCRIPT_TEXT_CHARS), timestamp)
        }
        codex::Event::Tool { name, detail } => {
            let text = match detail {
                Some(d) => format!("{name} · {}", preview(&d, TOOL_DETAIL_CHARS)),
                None => name,
            };
            item("assistant", "tool", text, timestamp)
        }
        codex::Event::Patch(patch) => {
            let files: Vec<&str> =
                patch.lines().filter_map(|l| codex::PATCH_HEADERS.iter().find_map(|p| l.strip_prefix(p))).collect();
            item("assistant", "tool", format!("apply_patch · {}", truncate_chars(&files.join(", "), TOOL_DETAIL_CHARS)), timestamp)
        }
        _ => return None,
    })
}

fn line_items(line: &str, out: &mut Vec<TranscriptItem>) {
    match parse_line(line, true) {
        Some(Parsed::Codex(record)) => out.extend(codex_item(record)),
        Some(Parsed::Claude(raw)) => claude_items(raw, out),
        None => {}
    }
}

pub(crate) fn transcript_from_lines<S: AsRef<str>>(lines: impl Iterator<Item = S>) -> Vec<TranscriptItem> {
    let mut items = Vec::new();
    for line in lines {
        line_items(line.as_ref(), &mut items);
    }
    items
}

pub fn transcript(file_path: &str, from_offset: u64) -> anyhow::Result<TranscriptPage> {
    let (path, _) = session_file(file_path)?;
    let mut file = fs::File::open(&path)?;
    let len = file.metadata()?.len();
    let start = if from_offset <= len && ends_line(&mut file, from_offset)? { from_offset } else { 0 };
    let (mut items, mut offset) = (Vec::new(), start);
    complete_lines(file, start, |line, end| {
        line_items(line, &mut items);
        offset = end;
    })?;
    Ok(TranscriptPage { items, offset, reset: start == 0 })
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

pub struct Needle {
    pub lower: String,
    pub prefilter: String,
    pub fold_ascii: bool,
    finder: AhoCorasick,
}

impl Needle {
    pub fn new(query: &str) -> Option<Self> {
        let lower = query.trim().to_lowercase();
        if lower.chars().count() < 2 {
            return None;
        }
        let escaped = serde_json::to_string(&lower).ok()?;
        let escaped = &escaped[1..escaped.len() - 1];
        let ascii_run = escaped.split(|c: char| !c.is_ascii()).max_by_key(|run| run.len()).filter(|run| run.len() >= 2);
        let (prefilter, fold_ascii) = match ascii_run {
            Some(run) => (run.to_string(), true),
            None => (escaped.to_string(), false),
        };
        let finder = AhoCorasick::builder().ascii_case_insensitive(fold_ascii).build([&prefilter]).ok()?;
        Some(Self { lower, prefilter, fold_ascii, finder })
    }

    fn may_match(&self, line: &[u8]) -> bool {
        self.finder.is_match(line)
    }
}

pub fn snippet_around(text: &str, needle_lower: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    let lower: Vec<char> = chars.iter().flat_map(|c| c.to_lowercase()).collect();
    let needle: Vec<char> = needle_lower.chars().collect();
    if lower.len() != chars.len() || needle.is_empty() {
        return text.to_lowercase().contains(needle_lower).then(|| preview(text, SNIPPET_RADIUS * 2));
    }
    let index = lower.windows(needle.len()).position(|w| w == needle.as_slice())?;
    let start = index.saturating_sub(SNIPPET_RADIUS);
    let end = (index + needle.len() + SNIPPET_RADIUS).min(chars.len());
    let body = preview(&chars[start..end].iter().collect::<String>(), usize::MAX);
    Some(format!("{}{}{}", if start > 0 { "…" } else { "" }, body, if end < chars.len() { "…" } else { "" }))
}

pub fn search_lines<S: AsRef<str>>(session_id: &str, lines: impl Iterator<Item = S>, needle: &Needle) -> Vec<SearchHit> {
    let mut hits = Vec::new();
    for line in lines {
        let mut items = Vec::new();
        line_items(line.as_ref(), &mut items);
        for item in items.into_iter().filter(|i| i.kind == "text") {
            if let Some(snippet) = snippet_around(&item.text, &needle.lower) {
                hits.push(SearchHit { session_id: session_id.to_string(), role: item.role, snippet, timestamp: item.timestamp });
            }
        }
        if hits.len() >= SEARCH_HITS_PER_SESSION {
            break;
        }
    }
    hits.truncate(SEARCH_HITS_PER_SESSION);
    hits
}

fn search_file(path: &Path, needle: &Needle, generation: u64) -> Vec<SearchHit> {
    let Ok(file) = fs::File::open(path) else { return Vec::new() };
    let session_id = session_id_for(&path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default());
    let candidates = BufReader::with_capacity(256 * 1024, file)
        .split(b'\n')
        .map_while(Result::ok)
        .take_while(|_| SEARCH_GENERATION.load(Ordering::Relaxed) == generation)
        .filter(|line| needle.may_match(line))
        .filter_map(|line| String::from_utf8(line).ok());
    search_lines(&session_id, candidates, needle)
}

pub fn begin_search() -> u64 {
    SEARCH_GENERATION.fetch_add(1, Ordering::Relaxed) + 1
}

pub fn search_is_current(generation: u64) -> bool {
    SEARCH_GENERATION.load(Ordering::Relaxed) == generation
}

pub fn search(needle: &Needle, generation: u64) -> Vec<SearchHit> {
    session_files().par_iter().flat_map_iter(|(path, _, _)| search_file(path, needle, generation)).collect()
}

pub fn delete_session(file_path: &str) -> anyhow::Result<()> {
    let (path, id) = session_file(file_path)?;
    if codex::is_rollout(&path) {
        trash::delete(&path).context("Couldn't move the session to the Recycle Bin")?;
        CACHE.lock().remove(file_path);
        return Ok(());
    }
    anyhow::ensure!(!live_sessions().iter().any(|l| l.session_id == id), "This session is still running. Close it first.");
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
        std::thread::sleep(Duration::from_millis(300));
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

    fn feed_all(lines: &[&str]) -> Accumulator {
        let mut acc = Accumulator::with_ids("00000000-0000-4000-8000-000000000001".into(), "f.jsonl".into(), "-w", None);
        for line in lines {
            acc.feed(line);
        }
        acc
    }

    #[test]
    fn accumulates_claude_sessions() {
        let acc = feed_all(&[
            r#"{"type":"user","cwd":"/w","gitBranch":"main","version":"2.1","timestamp":"t0","message":{"content":"first prompt"}}"#,
            r#"{"type":"assistant","timestamp":"t1","gitBranch":"","version":3,"message":{"content":[{"type":"text","text":"ok"}]}}"#,
            r#"{"type":"user","timestamp":"t2","message":{"content":[{"type":"tool_result","content":"x"}]}}"#,
            r#"{"type":"user","timestamp":"t3","isMeta":true,"message":{"content":"meta"}}"#,
            r#"{"type":"user","timestamp":"t4","isSidechain":true,"message":{"content":"side"}}"#,
            r#"{"type":"user","timestamp":"t5","message":{"content":[{"type":"text","text":"<system-reminder>x</system-reminder>"},{"type":"text","text":"second"}]}}"#,
            r#"{"type":"ai-title","aiTitle":"Generated"}"#,
            "not json",
        ]);
        let info = acc.finish_with(1, 2).unwrap();
        assert_eq!(info.prompt_count, 2);
        assert_eq!((info.first_prompt.as_deref(), info.last_prompt.as_deref()), (Some("first prompt"), Some("second")));
        assert_eq!((info.started_at.as_deref(), info.last_message_at.as_deref()), (Some("t0"), Some("t5")));
        assert_eq!((info.cwd.as_str(), info.git_branch.as_deref(), info.version.as_deref()), ("/w", None, Some("2.1")));
        assert_eq!(info.title.as_deref(), Some("Generated"));
    }

    #[test]
    fn remembers_recent_working_directories_newest_first() {
        let acc = feed_all(&[
            r#"{"type":"user","cwd":"/w","message":{"content":"a"}}"#,
            r#"{"type":"assistant","cwd":"/w/app","message":{"content":[]}}"#,
            r#"{"type":"assistant","cwd":"/w/app","message":{"content":[]}}"#,
            r#"{"type":"user","cwd":"/w","message":{"content":"b"}}"#,
            r#"{"type":"user","cwd":"","message":{"content":"c"}}"#,
        ]);
        let info = acc.finish_with(0, 0).unwrap();
        assert_eq!(info.cwd, "/w");
        assert_eq!(info.recent_cwds, ["/w", "/w/app"]);
    }

    #[test]
    fn codex_start_time_comes_from_session_meta() {
        let id = "019a0000-0000-7000-8000-000000000001";
        let mut acc = Accumulator::with_ids(id.into(), format!("/s/rollout-x-{id}.jsonl"), "", None);
        acc.feed(r#"{"timestamp":"10:39:03","type":"session_meta","payload":{"id":"11111111-1111-4111-8111-111111111111","timestamp":"10:38:22","cwd":"/w"}}"#);
        acc.feed(r#"{"timestamp":"10:39:04","type":"event_msg","payload":{"type":"user_message","message":"go"}}"#);
        acc.feed(r#"{"timestamp":"10:40:00","type":"session_meta","payload":{"timestamp":"09:00:00","cwd":"/other"}}"#);
        let info = acc.finish_with(0, 0).unwrap();
        assert_eq!((info.id.as_str(), info.agent.as_str(), info.cwd.as_str()), (id, "codex", "/w"));
        assert_eq!((info.started_at.as_deref(), info.last_message_at.as_deref()), (Some("10:38:22"), Some("10:40:00")));
    }

    #[test]
    fn reads_only_complete_lines_and_restarts_rewritten_files() {
        let dir = std::env::temp_dir().join(format!("deck-sessions-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("00000000-0000-4000-8000-000000000002.jsonl");
        let first = r#"{"type":"user","message":{"content":"one"}}"#;
        fs::write(&path, format!("{first}\n{{\"type\":\"user\",\"mess")).unwrap();
        let mut acc = Accumulator::new(&path, "-w");
        acc.read_from_offset(&path).unwrap();
        assert_eq!((acc.info.prompt_count, acc.offset), (1, first.len() as u64 + 1));
        fs::write(&path, format!("{first}\n{{\"type\":\"user\",\"message\":{{\"content\":\"two\"}}}}\n")).unwrap();
        acc.read_from_offset(&path).unwrap();
        assert_eq!(acc.info.prompt_count, 2);
        fs::write(&path, format!("{{\"type\":\"user\",\"message\":{{\"content\":\"rewritten prompt here\"}}}}\n{first}\n")).unwrap();
        acc.offset = first.len() as u64 + 1;
        acc.read_from_offset(&path).unwrap();
        assert_eq!((acc.info.prompt_count, acc.info.first_prompt.as_deref()), (2, Some("rewritten prompt here")));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn builds_transcripts() {
        let items = transcript_from_lines(
            [
                r#"{"type":"user","timestamp":"a","message":{"content":"hello"}}"#,
                r#"{"type":"assistant","timestamp":"b","message":{"content":[{"type":"thinking","thinking":"x"},{"type":"text","text":"hi"},{"type":"tool_use","name":"Bash","input":{"command":"ls   -la","content":"big"}}]}}"#,
                r#"{"type":"user","message":{"content":[{"type":"tool_result","content":[{"type":"text","text":"out"}]}]}}"#,
                r#"{"type":"response_item","timestamp":"c","payload":{"type":"custom_tool_call","name":"apply_patch","input":"*** Begin Patch\n*** Update File: a.rs\n*** Move to: b.rs\n*** End Patch"}}"#,
            ]
            .into_iter(),
        );
        let summary: Vec<_> = items.iter().map(|i| (i.role.as_str(), i.kind.as_str(), i.text.as_str())).collect();
        assert_eq!(
            summary,
            [
                ("user", "text", "hello"),
                ("assistant", "text", "hi"),
                ("assistant", "tool", "Bash · ls -la"),
                ("assistant", "tool", "apply_patch · a.rs, b.rs")
            ]
        );
    }

    #[test]
    fn search_needles_match_escaped_json_and_unicode() {
        let needle = Needle::new(r"C:\Users").unwrap();
        let line = serde_json::json!({"type":"user","message":{"content":r"look in C:\Users\me"}}).to_string();
        assert!(needle.may_match(line.as_bytes()));
        assert_eq!(search_lines("s", std::iter::once(line), &needle).len(), 1);
        let cafe = Needle::new("café").unwrap();
        let upper = serde_json::json!({"type":"user","message":{"content":"CAFÉ menu"}}).to_string();
        assert!(cafe.may_match(upper.as_bytes()));
        assert_eq!(search_lines("s", std::iter::once(upper), &cafe)[0].snippet, "CAFÉ menu");
        assert!(Needle::new("x").is_none());
    }

    #[test]
    #[ignore]
    fn probe_real_sessions() {
        let start = std::time::Instant::now();
        let sessions = list_sessions();
        let cold = start.elapsed();
        let start = std::time::Instant::now();
        let again = list_sessions();
        println!("sessions={} cold={cold:?} warm={:?} again={}", sessions.len(), start.elapsed(), again.len());
        println!("live={:?}", live_sessions());
    }
}
