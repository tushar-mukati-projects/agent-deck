use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use super::{
    accumulator::{parse_content, parse_line, user_prompt_text, Block, Content, Parsed, RawLine},
    complete_lines, ends_line, is_system_text, preview, session_file, truncate_chars,
};
use crate::{codex, util::lenient};

const TOOL_DETAIL_CHARS: usize = 160;
const TRANSCRIPT_TEXT_CHARS: usize = 24_000;
const AGENT_ID_MAX_CHARS: usize = 64;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptItem {
    pub role: String,
    pub kind: String,
    pub text: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptPage {
    pub items: Vec<TranscriptItem>,
    pub offset: u64,
    pub reset: bool,
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
    tool_text(name.to_string(), detail)
}

fn tool_text(name: String, detail: Option<String>) -> String {
    match detail {
        Some(d) => format!("{name} · {}", preview(&d, TOOL_DETAIL_CHARS)),
        None => name,
    }
}

fn item(role: &str, kind: &str, text: String) -> TranscriptItem {
    TranscriptItem { role: role.into(), kind: kind.into(), text }
}

fn claude_items(raw: RawLine, sidechain: bool, out: &mut Vec<TranscriptItem>) {
    let kind = raw.kind.as_deref().unwrap_or("");
    if (raw.is_sidechain && !sidechain) || !(kind == "user" || kind == "assistant") {
        return;
    }
    if kind == "user" && raw.is_meta {
        return;
    }
    let Some(content) = raw.message.and_then(|m| m.content) else { return };
    if kind == "user" {
        if let Some(text) = user_prompt_text(content) {
            out.push(item("user", "text", truncate_chars(&text, TRANSCRIPT_TEXT_CHARS)));
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
                out.push(item("assistant", "text", truncate_chars(&text, TRANSCRIPT_TEXT_CHARS)));
            }
        } else if block.is("tool_use") {
            let summary = summarize_tool(block.name.as_deref().unwrap_or("tool"), block.input);
            out.push(item("assistant", "tool", summary));
        }
    }
}

fn codex_item(record: codex::Record) -> Option<TranscriptItem> {
    Some(match record.event {
        codex::Event::User(text) if !is_system_text(&text) => item("user", "text", truncate_chars(&text, TRANSCRIPT_TEXT_CHARS)),
        codex::Event::Assistant(text) if !text.trim().is_empty() => {
            item("assistant", "text", truncate_chars(&text, TRANSCRIPT_TEXT_CHARS))
        }
        codex::Event::Tool { name, detail } => item("assistant", "tool", tool_text(name, detail)),
        codex::Event::Patch(patch) => {
            let files: Vec<&str> =
                patch.lines().filter_map(|l| codex::PATCH_HEADERS.iter().find_map(|p| l.strip_prefix(p))).collect();
            item("assistant", "tool", format!("apply_patch · {}", truncate_chars(&files.join(", "), TOOL_DETAIL_CHARS)))
        }
        _ => return None,
    })
}

pub(super) fn line_items(line: &str, sidechain: bool, out: &mut Vec<TranscriptItem>) {
    match parse_line(line, true) {
        Some(Parsed::Codex(record)) => out.extend(codex_item(record)),
        Some(Parsed::Claude(raw)) => claude_items(raw, sidechain, out),
        None => {}
    }
}

pub(crate) fn transcript_from_lines<S: AsRef<str>>(lines: impl Iterator<Item = S>, sidechain: bool) -> Vec<TranscriptItem> {
    let mut items = Vec::new();
    for line in lines {
        line_items(line.as_ref(), sidechain, &mut items);
    }
    items
}

fn read_page(path: &Path, from_offset: u64, sidechain: bool) -> anyhow::Result<TranscriptPage> {
    let mut file = fs::File::open(path)?;
    let len = file.metadata()?.len();
    let start = if from_offset <= len && ends_line(&mut file, from_offset)? { from_offset } else { 0 };
    let (mut items, mut offset) = (Vec::new(), start);
    complete_lines(file, start, |line, end| {
        line_items(line, sidechain, &mut items);
        offset = end;
    })?;
    Ok(TranscriptPage { items, offset, reset: start == 0 })
}

pub fn transcript(file_path: &str, from_offset: u64) -> anyhow::Result<TranscriptPage> {
    read_page(&session_file(file_path)?.0, from_offset, false)
}

pub fn is_agent_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= AGENT_ID_MAX_CHARS && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn subagent_file(dir: &Path, id: &str) -> Option<PathBuf> {
    let direct = dir.join(format!("agent-{id}.jsonl"));
    if direct.is_file() {
        return Some(direct);
    }
    fs::read_dir(dir).ok()?.flatten().map(|entry| entry.path()).find_map(|meta| {
        let name = meta.file_name()?.to_str()?.strip_suffix(".meta.json")?.to_string();
        let parsed: serde_json::Value = serde_json::from_slice(&fs::read(&meta).ok()?).ok()?;
        (parsed["toolUseId"] == id).then(|| dir.join(format!("{name}.jsonl"))).filter(|path| path.is_file())
    })
}

pub fn subagent_transcript(file_path: &str, id: &str, from_offset: u64) -> anyhow::Result<TranscriptPage> {
    anyhow::ensure!(is_agent_id(id), "not a subagent id");
    let (session, _) = session_file(file_path)?;
    anyhow::ensure!(!codex::is_rollout(&session), "not a Claude session file");
    match subagent_file(&session.with_extension("").join("subagents"), id) {
        Some(path) => read_page(&path, from_offset, true),
        None => Ok(TranscriptPage { items: Vec::new(), offset: 0, reset: true }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            false,
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
    fn reads_subagent_records_only_when_asked() {
        let lines = [
            r#"{"type":"user","isSidechain":true,"message":{"content":"research themes"}}"#,
            r#"{"type":"assistant","isSidechain":true,"message":{"content":[{"type":"text","text":"done"}]}}"#,
        ];
        assert!(transcript_from_lines(lines.iter(), false).is_empty());
        let texts: Vec<_> = transcript_from_lines(lines.iter(), true).into_iter().map(|i| i.text).collect();
        assert_eq!(texts, ["research themes", "done"]);
        assert!(is_agent_id("af390da93c3ee46b8") && !is_agent_id("../x") && !is_agent_id(""));
    }

    #[test]
    fn finds_subagent_files_by_agent_id_or_tool_call() {
        let dir = std::env::temp_dir().join(format!("deck-subagents-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("agent-a1.jsonl"), "{}\n").unwrap();
        fs::write(dir.join("agent-a1.meta.json"), r#"{"toolUseId":"toolu_1"}"#).unwrap();
        fs::write(dir.join("agent-a2.meta.json"), r#"{"toolUseId":"toolu_2"}"#).unwrap();
        assert_eq!(subagent_file(&dir, "a1"), Some(dir.join("agent-a1.jsonl")));
        assert_eq!(subagent_file(&dir, "toolu_1"), Some(dir.join("agent-a1.jsonl")));
        assert_eq!(subagent_file(&dir, "toolu_2"), None);
        assert_eq!(subagent_file(&dir, "toolu_3"), None);
        fs::remove_dir_all(&dir).unwrap();
    }
}
