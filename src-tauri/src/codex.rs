use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

use serde::Deserialize;

use crate::changes::ChangedFile;

pub const AGENT: &str = "codex";

#[derive(Deserialize)]
struct Line {
    timestamp: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
    payload: Option<Payload>,
}

#[derive(Deserialize, Default)]
struct Payload {
    #[serde(rename = "type")]
    kind: Option<String>,
    id: Option<String>,
    cwd: Option<String>,
    cli_version: Option<String>,
    message: Option<String>,
    git: Option<Git>,
    name: Option<String>,
    arguments: Option<String>,
    input: Option<String>,
}

#[derive(Deserialize)]
struct Git {
    branch: Option<String>,
}

pub enum Event {
    Meta { id: Option<String>, cwd: Option<String>, version: Option<String>, branch: Option<String> },
    Cwd(String),
    User(String),
    Assistant(String),
    Tool { name: String, detail: Option<String> },
    Patch(String),
    Activity,
}

pub struct Record {
    pub timestamp: Option<String>,
    pub event: Event,
}

pub fn is_codex_kind(kind: &str) -> bool {
    matches!(kind, "session_meta" | "event_msg" | "response_item" | "turn_context" | "compacted")
}

pub fn home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".codex"))
}

pub fn sessions_dir() -> PathBuf {
    home().join("sessions")
}

pub fn is_rollout(path: &Path) -> bool {
    path.extension().is_some_and(|x| x == "jsonl")
        && path.file_name().is_some_and(|n| n.to_string_lossy().starts_with("rollout-"))
}

pub fn id_from_name(stem: &str) -> Option<&str> {
    let tail = stem.get(stem.len().checked_sub(36)?..)?;
    crate::util::is_session_id(tail).then_some(tail)
}

pub fn session_files() -> Vec<(PathBuf, fs::Metadata)> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<(PathBuf, fs::Metadata)>) {
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() && depth > 0 {
                walk(&path, depth - 1, out);
            } else if meta.is_file() && is_rollout(&path) {
                out.push((path, meta));
            }
        }
    }
    let mut files = Vec::new();
    walk(&sessions_dir(), 3, &mut files);
    files
}

fn command_of(arguments: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(arguments).ok()?;
    let field = ["cmd", "command", "path", "query", "url"].iter().find_map(|k| value.get(*k))?;
    match field {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Array(parts) => {
            Some(parts.iter().filter_map(|p| p.as_str()).collect::<Vec<_>>().join(" "))
        }
        _ => None,
    }
}

fn patch_of(payload: &Payload) -> Option<String> {
    if payload.name.as_deref() != Some("apply_patch") {
        return None;
    }
    if let Some(input) = payload.input.clone() {
        return Some(input);
    }
    let value: serde_json::Value = serde_json::from_str(payload.arguments.as_deref()?).ok()?;
    ["input", "patch"].iter().find_map(|k| value.get(*k)?.as_str().map(str::to_string))
}

pub fn parse(line: &str) -> Option<Record> {
    let line: Line = serde_json::from_str(line).ok()?;
    let kind = line.kind.as_deref()?;
    if !is_codex_kind(kind) {
        return None;
    }
    let payload = line.payload.unwrap_or_default();
    let event = match (kind, payload.kind.as_deref()) {
        ("session_meta", _) => Event::Meta {
            id: payload.id,
            cwd: payload.cwd,
            version: payload.cli_version,
            branch: payload.git.and_then(|g| g.branch),
        },
        ("turn_context", _) => payload.cwd.map(Event::Cwd).unwrap_or(Event::Activity),
        ("event_msg", Some("user_message")) => payload.message.map(Event::User).unwrap_or(Event::Activity),
        ("event_msg", Some("agent_message")) => payload.message.map(Event::Assistant).unwrap_or(Event::Activity),
        ("response_item", Some("function_call" | "custom_tool_call")) => match patch_of(&payload) {
            Some(patch) => Event::Patch(patch),
            None => Event::Tool {
                detail: payload.arguments.as_deref().and_then(command_of),
                name: payload.name.unwrap_or_else(|| "tool".into()),
            },
        },
        _ => Event::Activity,
    };
    Some(Record { timestamp: line.timestamp, event })
}

#[derive(Default)]
struct FileChange {
    status: &'static str,
    additions: u32,
    deletions: u32,
    edits: u32,
}

fn apply_patch_text(patch: &str, cwd: &str, files: &mut BTreeMap<String, (String, FileChange)>) {
    let mut current: Option<String> = None;
    for line in patch.lines() {
        let header = [("*** Add File: ", "added"), ("*** Update File: ", "modified"), ("*** Delete File: ", "deleted")]
            .iter()
            .find_map(|(prefix, status)| line.strip_prefix(prefix).map(|p| (p.trim(), *status)));
        if let Some((raw, status)) = header {
            let absolute = resolve(cwd, raw);
            let key = absolute.replace('/', "\\").to_lowercase();
            let entry = files.entry(key.clone()).or_insert_with(|| (absolute, FileChange { status, ..Default::default() }));
            entry.1.edits += 1;
            entry.1.status = match (entry.1.status, status) {
                ("added", "modified") => "added",
                (_, next) => next,
            };
            current = Some(key);
            continue;
        }
        if line.starts_with("*** ") {
            if !line.starts_with("*** Move to: ") {
                current = None;
            }
            continue;
        }
        let Some(entry) = current.as_ref().and_then(|k| files.get_mut(k)) else { continue };
        if line.starts_with('+') {
            entry.1.additions += 1;
        } else if line.starts_with('-') {
            entry.1.deletions += 1;
        }
    }
}

fn resolve(cwd: &str, raw: &str) -> String {
    let is_absolute = raw.starts_with('/') || raw.starts_with('\\') || raw.get(1..2) == Some(":");
    if is_absolute || cwd.is_empty() {
        return raw.to_string();
    }
    let separator = if cwd.contains('\\') { '\\' } else { '/' };
    format!("{}{separator}{}", cwd.trim_end_matches(['/', '\\']), raw.replace(['/', '\\'], &separator.to_string()))
}

pub fn changes_from_lines(lines: impl Iterator<Item = String>, exists: impl Fn(&str) -> bool) -> Vec<ChangedFile> {
    let mut cwd = String::new();
    let mut files: BTreeMap<String, (String, FileChange)> = BTreeMap::new();
    for line in lines {
        let Some(record) = parse(&line) else { continue };
        match record.event {
            Event::Meta { cwd: Some(dir), .. } | Event::Cwd(dir) if cwd.is_empty() => cwd = dir,
            Event::Patch(patch) => apply_patch_text(&patch, &cwd, &mut files),
            _ => {}
        }
    }
    files
        .into_values()
        .filter(|(path, change)| change.status != "added" || exists(path))
        .map(|(path, change)| ChangedFile {
            status: if change.status == "deleted" && exists(&path) { "modified" } else { change.status }.to_string(),
            path,
            additions: change.additions,
            deletions: change.deletions,
            edits: change.edits,
            backup: None,
        })
        .collect()
}

pub fn session_changes(path: &Path) -> anyhow::Result<Vec<ChangedFile>> {
    let reader = BufReader::with_capacity(256 * 1024, fs::File::open(path)?);
    let lines = reader.split(b'\n').map_while(Result::ok).filter_map(|l| String::from_utf8(l).ok());
    Ok(changes_from_lines(lines, |p| Path::new(p).is_file()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_session_ids_from_rollout_names() {
        assert_eq!(
            id_from_name("rollout-2026-04-12T12-40-12-019a0000-0000-7000-8000-000000000001"),
            Some("019a0000-0000-7000-8000-000000000001")
        );
        assert_eq!(id_from_name("rollout-short"), None);
    }

    #[test]
    fn parses_core_records() {
        let meta = parse(r#"{"timestamp":"t0","type":"session_meta","payload":{"id":"019a0000-0000-7000-8000-000000000001","cwd":"/home/me/work","cli_version":"0.120.0","git":{"branch":"stage"}}}"#).unwrap();
        assert!(matches!(meta.event, Event::Meta { branch: Some(ref b), .. } if b == "stage"));
        let user = parse(r#"{"timestamp":"t1","type":"event_msg","payload":{"type":"user_message","message":"fix it"}}"#).unwrap();
        assert!(matches!(user.event, Event::User(ref m) if m == "fix it"));
        let tool = parse(r#"{"timestamp":"t2","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"ls -la\"}"}}"#).unwrap();
        assert!(matches!(tool.event, Event::Tool { ref detail, .. } if detail.as_deref() == Some("ls -la")));
        assert!(parse(r#"{"type":"user","message":{}}"#).is_none());
    }

    #[test]
    fn collects_files_from_patches() {
        let patch = "*** Begin Patch\n*** Update File: src/a.rs\n@@\n-old\n+new\n+more\n*** Add File: b.md\n+hi\n*** End Patch";
        let line = serde_json::json!({"type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","input":patch}}).to_string();
        let meta = r#"{"type":"session_meta","payload":{"cwd":"/w"}}"#.to_string();
        let files = changes_from_lines([meta, line].into_iter(), |_| true);
        assert_eq!(files.len(), 2);
        let a = files.iter().find(|f| f.path == "/w/src/a.rs").unwrap();
        assert_eq!((a.status.as_str(), a.additions, a.deletions), ("modified", 2, 1));
        assert_eq!(files.iter().find(|f| f.path == "/w/b.md").unwrap().status, "added");
    }
}
