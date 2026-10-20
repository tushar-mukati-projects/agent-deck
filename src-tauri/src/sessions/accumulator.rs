use std::{fs, io, path::Path};

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use super::{complete_lines, decode_project_key, default_agent, ends_line, is_system_text, preview, session_id_of, truncate_chars, SessionInfo};
use crate::{
    codex,
    util::{is_session_id, lenient, lenient_bool},
};

const PROMPT_PREVIEW_CHARS: usize = 280;
const TITLE_CHARS: usize = 80;
const RECENT_CWDS: usize = 6;
const TOOL_RESULT: &[u8] = br#""type":"tool_result""#;

#[derive(Deserialize)]
pub(super) struct RawLine<'a> {
    #[serde(rename = "type", default, deserialize_with = "lenient")]
    pub(super) kind: Option<String>,
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
    pub(super) is_meta: bool,
    #[serde(rename = "isSidechain", default, deserialize_with = "lenient_bool")]
    pub(super) is_sidechain: bool,
    #[serde(default, deserialize_with = "lenient")]
    version: Option<String>,
    #[serde(borrow, default)]
    pub(super) message: Option<RawMessage<'a>>,
    #[serde(borrow, default)]
    payload: Option<&'a RawValue>,
}

#[derive(Deserialize)]
pub(super) struct RawMessage<'a> {
    #[serde(borrow, default)]
    pub(super) content: Option<&'a RawValue>,
}

pub(super) enum Parsed<'a> {
    Claude(RawLine<'a>),
    Codex(codex::Record),
}

pub(super) fn parse_line(line: &str, detailed: bool) -> Option<Parsed<'_>> {
    let raw: RawLine = serde_json::from_str(line).ok()?;
    match raw.kind.as_deref() {
        Some(kind) if codex::is_codex_kind(kind) => codex::from_parts(kind, raw.timestamp, raw.payload, detailed).map(Parsed::Codex),
        _ => Some(Parsed::Claude(raw)),
    }
}

pub(super) enum Content<'a> {
    Text(String),
    Blocks(Vec<Block<'a>>),
}

#[derive(Deserialize)]
pub(super) struct Block<'a> {
    #[serde(rename = "type", default, deserialize_with = "lenient")]
    pub(super) kind: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub(super) text: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    pub(super) name: Option<String>,
    #[serde(borrow, default)]
    pub(super) input: Option<&'a RawValue>,
}

impl Block<'_> {
    pub(super) fn is(&self, kind: &str) -> bool {
        self.kind.as_deref() == Some(kind)
    }
}

pub(super) fn parse_content(raw: &RawValue) -> Option<Content<'_>> {
    let text = raw.get();
    match text.as_bytes().first()? {
        b'"' => serde_json::from_str(text).ok().map(Content::Text),
        b'[' => serde_json::from_str(text).ok().map(Content::Blocks),
        _ => None,
    }
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

pub(super) fn user_prompt_text(content: &RawValue) -> Option<String> {
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

impl Accumulator {
    pub(super) fn new(path: &Path, project_key: &str) -> Self {
        Self::with_ids(session_id_of(&path.to_string_lossy()), path.to_string_lossy().to_string(), project_key, None)
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
        Self::with_ids(session_id_of(&info.file_path), info.file_path.clone(), &info.project_key, info.distro.clone())
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
        if self.info.started_at.is_none() {
            self.info.started_at = timestamp;
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

    pub(super) fn read_from_offset(&mut self, path: &Path) -> io::Result<()> {
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(info.started_at.as_deref(), Some("t0"));
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
        assert_eq!(info.started_at.as_deref(), Some("10:38:22"));
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
}
