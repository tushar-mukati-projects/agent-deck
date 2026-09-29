use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use serde_json::value::RawValue;

use crate::{
    changes::{ChangeStatus, ChangedFile},
    util::{is_session_id, jsonl_lines, lenient},
};

pub const AGENT: &str = "codex";

#[derive(Deserialize, Default)]
struct Payload<'a> {
    #[serde(rename = "type", default, deserialize_with = "lenient")]
    kind: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    id: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    cwd: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    cli_version: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    timestamp: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    message: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    name: Option<String>,
    #[serde(borrow, default)]
    git: Option<&'a RawValue>,
    #[serde(borrow, default)]
    arguments: Option<&'a RawValue>,
    #[serde(borrow, default)]
    input: Option<&'a RawValue>,
}

#[derive(Deserialize)]
struct Git {
    #[serde(default, deserialize_with = "lenient")]
    branch: Option<String>,
}

#[derive(Deserialize)]
struct Line<'a> {
    #[serde(rename = "type", default, deserialize_with = "lenient")]
    kind: Option<String>,
    #[serde(default, deserialize_with = "lenient")]
    timestamp: Option<String>,
    #[serde(borrow, default)]
    payload: Option<&'a RawValue>,
}

pub enum Event {
    Meta { id: Option<String>, cwd: Option<String>, version: Option<String>, branch: Option<String>, started: Option<String> },
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
    is_session_id(tail).then_some(tail)
}

pub fn session_files() -> Vec<(PathBuf, fs::Metadata)> {
    fn walk(dir: &Path, depth: usize, out: &mut Vec<(PathBuf, fs::Metadata)>) {
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            if kind.is_dir() && depth > 0 {
                walk(&path, depth - 1, out);
            } else if kind.is_file() && is_rollout(&path) {
                if let Ok(meta) = fs::metadata(&path) {
                    out.push((path, meta));
                }
            }
        }
    }
    let mut files = Vec::new();
    walk(&sessions_dir(), 3, &mut files);
    files
}

fn json_string(raw: Option<&RawValue>) -> Option<String> {
    serde_json::from_str::<String>(raw?.get()).ok()
}

fn command_of(arguments: Option<&RawValue>) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(&json_string(arguments)?).ok()?;
    let field = ["cmd", "command", "path", "query", "url"].iter().find_map(|k| value.get(*k))?;
    match field {
        serde_json::Value::String(text) => Some(text.clone()),
        serde_json::Value::Array(parts) => Some(parts.iter().filter_map(|p| p.as_str()).collect::<Vec<_>>().join(" ")),
        _ => None,
    }
}

fn patch_of(payload: &Payload) -> Option<String> {
    if payload.name.as_deref() != Some("apply_patch") {
        return None;
    }
    if let Some(input) = json_string(payload.input).filter(|s| !s.is_empty()) {
        return Some(input);
    }
    let value: serde_json::Value = serde_json::from_str(&json_string(payload.arguments)?).ok()?;
    ["input", "patch"].iter().find_map(|k| value.get(*k)?.as_str().map(str::to_string))
}

pub fn from_parts(kind: &str, timestamp: Option<String>, payload: Option<&RawValue>, detailed: bool) -> Option<Record> {
    if !is_codex_kind(kind) {
        return None;
    }
    let payload: Payload = payload.and_then(|p| serde_json::from_str(p.get()).ok()).unwrap_or_default();
    let event = match (kind, payload.kind.as_deref()) {
        ("session_meta", _) => Event::Meta {
            branch: payload.git.and_then(|g| serde_json::from_str::<Git>(g.get()).ok()).and_then(|g| g.branch),
            id: payload.id,
            cwd: payload.cwd,
            version: payload.cli_version,
            started: payload.timestamp,
        },
        ("turn_context", _) => payload.cwd.map(Event::Cwd).unwrap_or(Event::Activity),
        ("event_msg", Some("user_message")) => payload.message.map(Event::User).unwrap_or(Event::Activity),
        ("event_msg", Some("agent_message")) => payload.message.map(Event::Assistant).unwrap_or(Event::Activity),
        ("response_item", Some("function_call" | "custom_tool_call")) if detailed => match patch_of(&payload) {
            Some(patch) => Event::Patch(patch),
            None => Event::Tool { detail: command_of(payload.arguments), name: payload.name.unwrap_or_else(|| "tool".into()) },
        },
        _ => Event::Activity,
    };
    Some(Record { timestamp, event })
}

pub fn parse(line: &str) -> Option<Record> {
    let line: Line = serde_json::from_str(line).ok()?;
    from_parts(line.kind.as_deref()?, line.timestamp, line.payload, true)
}

pub const PATCH_HEADERS: [&str; 4] = ["*** Add File: ", "*** Update File: ", "*** Delete File: ", "*** Move to: "];

#[derive(Clone)]
struct FileChange {
    path: String,
    status: ChangeStatus,
    created: bool,
    additions: u32,
    deletions: u32,
    edits: u32,
}

fn key_of(path: &str) -> String {
    let windows = path.contains('\\') || path.get(1..2) == Some(":");
    if windows {
        path.replace('/', "\\").to_lowercase()
    } else {
        path.to_string()
    }
}

#[derive(Default)]
struct Changes {
    files: BTreeMap<String, FileChange>,
}

impl Changes {
    fn touch(&mut self, path: String, status: ChangeStatus) -> String {
        let key = key_of(&path);
        let existing = self.files.remove(&key);
        let created = existing.as_ref().map_or(status == ChangeStatus::Added, |f| f.created);
        let status = match (existing.as_ref().map(|f| f.status), status) {
            (Some(ChangeStatus::Deleted), ChangeStatus::Added) if !created => ChangeStatus::Modified,
            (_, ChangeStatus::Modified) if created => ChangeStatus::Added,
            (_, next) => next,
        };
        let mut change = existing.unwrap_or(FileChange { path, status, created, additions: 0, deletions: 0, edits: 0 });
        change.status = status;
        change.created = created;
        change.edits += 1;
        if status == ChangeStatus::Deleted && created {
            return key;
        }
        self.files.insert(key.clone(), change);
        key
    }

    fn rename(&mut self, from: &str, to: String) -> String {
        let Some(mut moved) = self.files.remove(from) else { return self.touch(to, ChangeStatus::Added) };
        if !moved.created {
            let source = FileChange { status: ChangeStatus::Deleted, additions: 0, deletions: 0, ..moved.clone() };
            self.files.insert(from.to_string(), source);
        }
        let key = key_of(&to);
        moved.path = to;
        moved.status = ChangeStatus::Added;
        moved.created = true;
        self.files.insert(key.clone(), moved);
        key
    }

    fn apply_patch(&mut self, patch: &str, cwd: &str) {
        let mut current: Option<String> = None;
        for line in patch.lines() {
            if let Some(raw) = line.strip_prefix("*** Move to: ") {
                if let Some(from) = current.take() {
                    current = Some(self.rename(&from, resolve(cwd, raw.trim())));
                }
                continue;
            }
            let header = [("*** Add File: ", ChangeStatus::Added), ("*** Update File: ", ChangeStatus::Modified), ("*** Delete File: ", ChangeStatus::Deleted)]
                .into_iter()
                .find_map(|(prefix, status)| line.strip_prefix(prefix).map(|p| (p.trim(), status)));
            if let Some((raw, status)) = header {
                current = Some(self.touch(resolve(cwd, raw), status));
                continue;
            }
            if line.starts_with("*** ") {
                current = None;
                continue;
            }
            let Some(change) = current.as_ref().and_then(|k| self.files.get_mut(k)) else { continue };
            if line.starts_with('+') {
                change.additions += 1;
            } else if line.starts_with('-') {
                change.deletions += 1;
            }
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

pub fn changes_from_lines(
    lines: impl Iterator<Item = String>,
    existing: impl FnOnce(&[String]) -> HashSet<String>,
) -> Vec<ChangedFile> {
    let mut cwd = String::new();
    let mut changes = Changes::default();
    for line in lines {
        let Some(record) = parse(&line) else { continue };
        match record.event {
            Event::Meta { cwd: Some(dir), .. } if cwd.is_empty() => cwd = dir,
            Event::Cwd(dir) if !dir.is_empty() => cwd = dir,
            Event::Patch(patch) => changes.apply_patch(&patch, &cwd),
            _ => {}
        }
    }
    let paths: Vec<String> = changes.files.values().map(|f| f.path.clone()).collect();
    let present = existing(&paths);
    changes
        .files
        .into_values()
        .filter_map(|change| {
            let exists = present.contains(&change.path);
            let status = match change.status {
                ChangeStatus::Added if !exists => return None,
                ChangeStatus::Deleted if exists => ChangeStatus::Modified,
                ChangeStatus::Modified if !exists => ChangeStatus::Deleted,
                status => status,
            };
            Some(ChangedFile {
                path: change.path,
                status,
                additions: change.additions,
                deletions: change.deletions,
                edits: change.edits,
                backup: None,
            })
        })
        .collect()
}

pub fn session_changes(path: &Path) -> anyhow::Result<Vec<ChangedFile>> {
    let lines = jsonl_lines(fs::File::open(path)?);
    Ok(changes_from_lines(lines, |paths| paths.iter().filter(|p| Path::new(p).is_file()).cloned().collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patch_line(patch: &str) -> String {
        serde_json::json!({"type":"response_item","payload":{"type":"custom_tool_call","name":"apply_patch","input":patch}}).to_string()
    }

    fn run(patches: &[&str], present: &[&str]) -> Vec<(String, ChangeStatus, u32, u32)> {
        let meta = r#"{"type":"session_meta","payload":{"cwd":"/w"}}"#.to_string();
        let lines = std::iter::once(meta).chain(patches.iter().map(|p| patch_line(p)));
        let present: HashSet<String> = present.iter().map(|p| p.to_string()).collect();
        changes_from_lines(lines, |_| present)
            .into_iter()
            .map(|f| (f.path, f.status, f.additions, f.deletions))
            .collect()
    }

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
        let meta = parse(r#"{"timestamp":"t0","type":"session_meta","payload":{"id":"019a0000-0000-7000-8000-000000000001","timestamp":"t-start","cwd":"/home/me/work","cli_version":"0.120.0","git":{"branch":"stage"}}}"#).unwrap();
        assert!(matches!(meta.event, Event::Meta { branch: Some(ref b), started: Some(ref s), .. } if b == "stage" && s == "t-start"));
        let user = parse(r#"{"timestamp":"t1","type":"event_msg","payload":{"type":"user_message","message":"fix it"}}"#).unwrap();
        assert!(matches!(user.event, Event::User(ref m) if m == "fix it"));
        let tool = parse(r#"{"timestamp":"t2","type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"ls -la\"}"}}"#).unwrap();
        assert!(matches!(tool.event, Event::Tool { ref detail, .. } if detail.as_deref() == Some("ls -la")));
        let odd = parse(r#"{"type":"session_meta","payload":{"id":5,"cwd":"/x","git":"none"}}"#).unwrap();
        assert!(matches!(odd.event, Event::Meta { id: None, cwd: Some(_), branch: None, .. }));
        assert!(parse(r#"{"type":"user","message":{}}"#).is_none());
    }

    #[test]
    fn reads_patches_from_function_call_arguments() {
        let arguments = serde_json::json!({"input": "*** Begin Patch\n*** Update File: a.rs\n+x\n*** End Patch"}).to_string();
        let line = serde_json::json!({"type":"response_item","payload":{"type":"function_call","name":"apply_patch","arguments":arguments,"input":""}}).to_string();
        assert!(matches!(parse(&line).unwrap().event, Event::Patch(ref p) if p.contains("a.rs")));
    }

    #[test]
    fn collects_files_from_patches() {
        let patch = "*** Begin Patch\n*** Update File: src/a.rs\n@@\n-old\n+new\n+more\n*** Add File: b.md\n+hi\n*** End Patch";
        let files = run(&[patch], &["/w/src/a.rs", "/w/b.md"]);
        assert_eq!(files, [("/w/b.md".into(), ChangeStatus::Added, 1, 0), ("/w/src/a.rs".into(), ChangeStatus::Modified, 2, 1)]);
    }

    #[test]
    fn follows_moves_deletes_and_later_cwds() {
        let moved = "*** Begin Patch\n*** Update File: old.rs\n*** Move to: new.rs\n+x\n*** End Patch";
        assert_eq!(
            run(&[moved], &["/w/new.rs"]),
            [("/w/new.rs".into(), ChangeStatus::Added, 1, 0), ("/w/old.rs".into(), ChangeStatus::Deleted, 0, 0)]
        );
        let add_then_delete = ["*** Begin Patch\n*** Add File: tmp.txt\n+x\n*** End Patch", "*** Begin Patch\n*** Delete File: tmp.txt\n*** End Patch"];
        assert!(run(&add_then_delete, &[]).is_empty());
        let gone = "*** Begin Patch\n*** Update File: gone.rs\n+x\n*** End Patch";
        assert_eq!(run(&[gone], &[])[0].1, ChangeStatus::Deleted);
        let cwd_change = r#"{"type":"turn_context","payload":{"cwd":"/other"}}"#.to_string();
        let meta = r#"{"type":"session_meta","payload":{"cwd":"/w"}}"#.to_string();
        let lines = [meta, cwd_change, patch_line("*** Begin Patch\n*** Update File: z.rs\n*** End Patch")];
        let files = changes_from_lines(lines.into_iter(), |paths| paths.iter().cloned().collect());
        assert_eq!(files[0].path, "/other/z.rs");
    }

    #[test]
    fn keeps_linux_path_case() {
        let patch = "*** Begin Patch\n*** Update File: A.rs\n*** Update File: a.rs\n*** End Patch";
        assert_eq!(run(&[patch], &["/w/A.rs", "/w/a.rs"]).len(), 2);
    }
}
