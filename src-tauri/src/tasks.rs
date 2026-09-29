use std::{collections::HashMap, fs, sync::LazyLock};

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;

use crate::sessions;

const MARKERS: &[&str] = &[
    "\"run_in_background\":true",
    "\"backgroundTaskId\"",
    "running in background with ID",
    "<task-notification>",
    "\"name\":\"TaskStop\"",
    "\"name\":\"KillShell\"",
];
const SHELL_TOOLS: &[&str] = &["Bash", "PowerShell"];
const STOP_TOOLS: &[&str] = &["TaskStop", "KillShell"];
const MAX_LINE: usize = 256 * 1024;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Running,
    Completed,
    Failed,
    Killed,
    Stopped,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentTask {
    pub id: String,
    pub tool: String,
    pub command: String,
    pub description: Option<String>,
    pub output_path: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub status: TaskStatus,
    pub summary: Option<String>,
}

#[derive(Clone)]
struct Started {
    tool: String,
    command: String,
    description: Option<String>,
    at: Option<String>,
}

#[derive(Default, Clone)]
pub struct TaskLog {
    pub offset: u64,
    started: HashMap<String, Started>,
    tasks: Vec<AgentTask>,
}

static LOGS: LazyLock<Mutex<HashMap<String, TaskLog>>> = LazyLock::new(Mutex::default);

pub fn might_matter(line: &str) -> bool {
    line.len() <= MAX_LINE && MARKERS.iter().any(|marker| line.contains(marker))
}

fn text(value: &Value) -> Option<String> {
    value.as_str().map(str::to_string)
}

fn tag<'a>(chunk: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let start = chunk.find(&open)? + open.len();
    let end = chunk[start..].find(&format!("</{name}>"))?;
    Some(chunk[start..start + end].trim())
}

fn output_path(result: &str) -> Option<String> {
    let rest = &result[result.find("written to: ")? + "written to: ".len()..];
    let end = rest.find(".output")? + ".output".len();
    Some(rest[..end].trim().to_string())
}

fn task_id_from(result: &str) -> Option<String> {
    let rest = &result[result.find("with ID: ")? + "with ID: ".len()..];
    let id: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-').collect();
    (!id.is_empty()).then_some(id)
}

fn result_text(block: &Value) -> String {
    match &block["content"] {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join(""),
        _ => String::new(),
    }
}

fn status_of(text: &str) -> Option<TaskStatus> {
    Some(match text {
        "completed" => TaskStatus::Completed,
        "failed" => TaskStatus::Failed,
        "killed" => TaskStatus::Killed,
        "stopped" => TaskStatus::Stopped,
        _ => return None,
    })
}

impl TaskLog {
    fn finish(&mut self, id: &str, status: TaskStatus, at: Option<String>, summary: Option<String>) {
        if let Some(task) = self.tasks.iter_mut().find(|t| t.id == id) {
            task.status = status;
            task.ended_at = at.or(task.ended_at.take());
            task.summary = summary.or(task.summary.take());
        }
    }

    fn feed_assistant(&mut self, content: &[Value], at: &Option<String>) {
        for block in content.iter().filter(|b| b["type"] == "tool_use") {
            let name = block["name"].as_str().unwrap_or_default();
            let input = &block["input"];
            if SHELL_TOOLS.contains(&name) && input["run_in_background"] == true {
                let (Some(id), Some(command)) = (text(&block["id"]), text(&input["command"])) else { continue };
                self.started.insert(
                    id,
                    Started { tool: name.to_string(), command, description: text(&input["description"]), at: at.clone() },
                );
            } else if STOP_TOOLS.contains(&name) {
                if let Some(id) = text(&input["task_id"]).or_else(|| text(&input["shell_id"])) {
                    self.finish(&id, TaskStatus::Killed, at.clone(), None);
                }
            }
        }
    }

    fn feed_results(&mut self, record: &Value, content: &[Value]) {
        for block in content.iter().filter(|b| b["type"] == "tool_result") {
            let Some(started) = block["tool_use_id"].as_str().and_then(|id| self.started.remove(id)) else { continue };
            let result = result_text(block);
            let Some(id) = text(&record["toolUseResult"]["backgroundTaskId"]).or_else(|| task_id_from(&result)) else {
                continue;
            };
            self.tasks.retain(|t| t.id != id);
            self.tasks.push(AgentTask {
                id,
                tool: started.tool,
                command: started.command,
                description: started.description,
                output_path: output_path(&result),
                started_at: started.at,
                ended_at: None,
                status: TaskStatus::Running,
                summary: None,
            });
        }
    }

    fn feed_notifications(&mut self, text: &str, at: &Option<String>) {
        for chunk in text.split("<task-notification>").skip(1) {
            let (Some(id), Some(status)) = (tag(chunk, "task-id"), tag(chunk, "status").and_then(status_of)) else { continue };
            self.finish(id, status, at.clone(), tag(chunk, "summary").map(str::to_string));
        }
    }

    pub fn feed(&mut self, line: &str) {
        let Ok(record) = serde_json::from_str::<Value>(line) else { return };
        let at = text(&record["timestamp"]);
        if let Some(queued) = record["content"].as_str().or_else(|| record["attachment"]["prompt"].as_str()) {
            self.feed_notifications(queued, &at);
        }
        let content = &record["message"]["content"];
        match (record["type"].as_str(), content) {
            (Some("assistant"), Value::Array(blocks)) => self.feed_assistant(blocks, &at),
            (Some("user"), Value::String(text)) => self.feed_notifications(text, &at),
            (Some("user"), Value::Array(blocks)) => {
                self.feed_results(&record, blocks);
                for block in blocks.iter().filter(|b| b["type"] == "text") {
                    if let Some(text) = block["text"].as_str() {
                        self.feed_notifications(text, &at);
                    }
                }
            }
            _ => {}
        }
    }

    pub fn tasks(&self) -> Vec<AgentTask> {
        self.tasks.iter().rev().cloned().collect()
    }
}

pub fn take(key: &str) -> TaskLog {
    LOGS.lock().remove(key).unwrap_or_default()
}

pub fn put(key: &str, log: TaskLog) {
    LOGS.lock().insert(key.to_string(), log);
}

pub fn local(file_path: &str) -> anyhow::Result<Vec<AgentTask>> {
    let (path, _) = sessions::session_file(file_path)?;
    let mut log = take(file_path);
    let mut file = fs::File::open(&path)?;
    if log.offset > file.metadata()?.len() || !sessions::ends_line(&mut file, log.offset)? {
        log = TaskLog::default();
    }
    sessions::complete_lines(file, log.offset, |line, end| {
        if might_matter(line) {
            log.feed(line);
        }
        log.offset = end;
    })?;
    let tasks = log.tasks();
    put(file_path, log);
    Ok(tasks)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(lines: &[&str]) -> Vec<AgentTask> {
        let mut log = TaskLog::default();
        for line in lines {
            if might_matter(line) {
                log.feed(line);
            }
        }
        log.tasks()
    }

    const START: &str = r#"{"type":"assistant","timestamp":"t1","message":{"content":[{"type":"tool_use","id":"tu1","name":"PowerShell","input":{"command":"npm run dev","description":"Start dev server","run_in_background":true}}]}}"#;
    const RESULT: &str = r#"{"type":"user","timestamp":"t2","toolUseResult":{"backgroundTaskId":"bg1"},"message":{"content":[{"type":"tool_result","tool_use_id":"tu1","content":"Command running in background with ID: bg1. Output is being written to: C:\\T\\tasks\\bg1.output. You will be notified when it completes."}]}}"#;

    #[test]
    fn tracks_background_shells_from_start_to_finish() {
        let running = feed(&[START, RESULT]);
        assert_eq!(running.len(), 1);
        assert_eq!(running[0].id, "bg1");
        assert_eq!(running[0].command, "npm run dev");
        assert_eq!(running[0].output_path.as_deref(), Some(r"C:\T\tasks\bg1.output"));
        assert_eq!(running[0].status, TaskStatus::Running);

        let done = feed(&[
            START,
            RESULT,
            r#"{"type":"user","timestamp":"t3","message":{"content":"<task-notification>\n<task-id>bg1</task-id>\n<status>failed</status>\n<summary>Exited with 1</summary>\n</task-notification>"}}"#,
        ]);
        assert_eq!((done[0].status, done[0].ended_at.as_deref(), done[0].summary.as_deref()), (TaskStatus::Failed, Some("t3"), Some("Exited with 1")));
    }

    #[test]
    fn marks_stopped_tasks_and_ignores_foreground_or_quoted_text() {
        let stopped = feed(&[
            START,
            RESULT,
            r#"{"type":"assistant","timestamp":"t4","message":{"content":[{"type":"tool_use","id":"tu2","name":"TaskStop","input":{"task_id":"bg1"}}]}}"#,
        ]);
        assert_eq!(stopped[0].status, TaskStatus::Killed);

        let none = feed(&[
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu3","name":"Bash","input":{"command":"ls","run_in_background":false}}]}}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tu9","content":"\"run_in_background\":true <task-notification><task-id>bg1</task-id><status>completed</status>"}]}}"#,
        ]);
        assert!(none.is_empty());
    }

    #[test]
    fn reads_notifications_from_queue_records_and_attachments() {
        let queued = feed(&[
            START,
            RESULT,
            r#"{"type":"queue-operation","operation":"enqueue","timestamp":"t5","content":"<task-notification>\n<task-id>bg1</task-id>\n<status>completed</status>\n</task-notification>"}"#,
        ]);
        assert_eq!((queued[0].status, queued[0].ended_at.as_deref()), (TaskStatus::Completed, Some("t5")));

        let attached = feed(&[
            START,
            RESULT,
            r#"{"type":"attachment","timestamp":"t6","attachment":{"type":"queued_command","prompt":"<task-notification><task-id>bg1</task-id><status>killed</status></task-notification>"}}"#,
        ]);
        assert_eq!(attached[0].status, TaskStatus::Killed);
    }

    #[test]
    fn falls_back_to_the_id_in_the_result_text() {
        let result = RESULT.replace(r#""toolUseResult":{"backgroundTaskId":"bg1"},"#, "");
        let tasks = feed(&[START, &result]);
        assert_eq!(tasks[0].id, "bg1");
    }
}
