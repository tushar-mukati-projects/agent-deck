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
    "\"name\":\"Agent\"",
    "\"name\":\"Task\"",
    "\"name\":\"SendMessage\"",
    "\"agentId\"",
    "Async agent launched",
];
const SHELL_TOOLS: &[&str] = &["Bash", "PowerShell"];
const AGENT_TOOLS: &[&str] = &["Agent", "Task"];
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
    pub command: String,
    pub description: Option<String>,
    pub output_path: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub status: TaskStatus,
    pub summary: Option<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Subagent {
    pub id: String,
    pub agent_id: Option<String>,
    pub description: Option<String>,
    pub agent_type: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub status: TaskStatus,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct SessionTasks {
    pub shells: Vec<AgentTask>,
    pub agents: Vec<Subagent>,
}

#[derive(Clone)]
struct Started {
    command: String,
    description: Option<String>,
    at: Option<String>,
}

#[derive(Default, Clone)]
pub struct TaskLog {
    pub offset: u64,
    started: HashMap<String, Started>,
    tasks: Vec<AgentTask>,
    agents: Vec<Subagent>,
}

static LOGS: LazyLock<Mutex<HashMap<String, TaskLog>>> = LazyLock::new(Mutex::default);

fn might_matter(line: &str) -> bool {
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

fn id_after(result: &str, label: &str) -> Option<String> {
    let rest = &result[result.find(label)? + label.len()..];
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
            task.ended_at = at.clone().or(task.ended_at.take());
            task.summary = summary.or(task.summary.take());
        }
        if let Some(agent) = self.agents.iter_mut().find(|a| a.id == id || a.agent_id.as_deref() == Some(id)) {
            agent.status = status;
            agent.ended_at = at.or(agent.ended_at.take());
        }
    }

    fn feed_assistant(&mut self, content: &[Value], at: &Option<String>) {
        for block in content.iter().filter(|b| b["type"] == "tool_use") {
            let name = block["name"].as_str().unwrap_or_default();
            let input = &block["input"];
            if SHELL_TOOLS.contains(&name) && input["run_in_background"] == true {
                let (Some(id), Some(command)) = (text(&block["id"]), text(&input["command"])) else { continue };
                self.started.insert(id, Started { command, description: text(&input["description"]), at: at.clone() });
            } else if AGENT_TOOLS.contains(&name) {
                let Some(id) = text(&block["id"]) else { continue };
                self.agents.retain(|a| a.id != id);
                self.agents.push(Subagent {
                    id,
                    agent_id: None,
                    description: text(&input["description"]),
                    agent_type: text(&input["subagent_type"]),
                    started_at: at.clone(),
                    ended_at: None,
                    status: TaskStatus::Running,
                });
            } else if STOP_TOOLS.contains(&name) {
                if let Some(id) = text(&input["task_id"]).or_else(|| text(&input["shell_id"])) {
                    self.finish(&id, TaskStatus::Killed, at.clone(), None);
                }
            } else if name == "SendMessage" {
                let to = input["to"].as_str().filter(|to| !to.is_empty());
                let resumed = self.agents.iter_mut().find(|a| a.status != TaskStatus::Running && to.is_some() && a.agent_id.as_deref() == to);
                if let Some(agent) = resumed {
                    agent.status = TaskStatus::Running;
                    agent.started_at = at.clone();
                    agent.ended_at = None;
                }
            }
        }
    }

    fn feed_agent_result(&mut self, record: &Value, block: &Value, at: &Option<String>) -> bool {
        let Some(agent) = block["tool_use_id"].as_str().and_then(|id| self.agents.iter_mut().find(|a| a.id == id)) else {
            return false;
        };
        let outcome = &record["toolUseResult"];
        let result = result_text(block);
        agent.agent_id = text(&outcome["agentId"]).or_else(|| id_after(&result, "agentId: ")).or(agent.agent_id.take());
        if outcome["status"] != "async_launched" && !result.starts_with("Async agent launched") {
            agent.status = if block["is_error"] == true { TaskStatus::Failed } else { TaskStatus::Completed };
            agent.ended_at = at.clone();
        }
        true
    }

    fn feed_results(&mut self, record: &Value, content: &[Value], at: &Option<String>) {
        for block in content.iter().filter(|b| b["type"] == "tool_result") {
            if self.feed_agent_result(record, block, at) {
                continue;
            }
            let Some(started) = block["tool_use_id"].as_str().and_then(|id| self.started.remove(id)) else { continue };
            let result = result_text(block);
            let Some(id) = text(&record["toolUseResult"]["backgroundTaskId"]).or_else(|| id_after(&result, "with ID: ")) else {
                continue;
            };
            self.tasks.retain(|t| t.id != id);
            self.tasks.push(AgentTask {
                id,
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
            if let Some(call) = tag(chunk, "tool-use-id").filter(|call| *call != id) {
                self.finish(call, status, at.clone(), None);
            }
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
                self.feed_results(&record, blocks, &at);
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

    pub fn snapshot(&self) -> SessionTasks {
        SessionTasks { shells: self.tasks(), agents: self.agents.iter().rev().cloned().collect() }
    }
}

pub fn take(key: &str) -> TaskLog {
    LOGS.lock().remove(key).unwrap_or_default()
}

pub fn put(key: &str, log: TaskLog) {
    LOGS.lock().insert(key.to_string(), log);
}

pub fn local(file_path: &str) -> anyhow::Result<SessionTasks> {
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
    let tasks = log.snapshot();
    put(file_path, log);
    Ok(tasks)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log_of(lines: &[&str]) -> TaskLog {
        let mut log = TaskLog::default();
        for line in lines {
            if might_matter(line) {
                log.feed(line);
            }
        }
        log
    }

    fn feed(lines: &[&str]) -> Vec<AgentTask> {
        log_of(lines).tasks()
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

    fn agents(lines: &[&str]) -> Vec<Subagent> {
        log_of(lines).snapshot().agents
    }

    const AGENT_START: &str = r#"{"type":"assistant","timestamp":"t1","message":{"content":[{"type":"tool_use","id":"tu7","name":"Agent","input":{"description":"Research themes","subagent_type":"general-purpose","prompt":"go","run_in_background":"true"}}]}}"#;
    const AGENT_LAUNCHED: &str = r#"{"type":"user","timestamp":"t2","toolUseResult":{"isAsync":true,"status":"async_launched","agentId":"a1b2"},"message":{"content":[{"type":"tool_result","tool_use_id":"tu7","content":[{"type":"text","text":"Async agent launched successfully.\nagentId: a1b2 (internal ID)"}]}]}}"#;

    #[test]
    fn tracks_background_agents_until_they_finish_or_are_stopped() {
        let running = agents(&[AGENT_START, AGENT_LAUNCHED]);
        assert_eq!(running.len(), 1);
        assert_eq!(
            (running[0].agent_id.as_deref(), running[0].status, running[0].description.as_deref(), running[0].agent_type.as_deref()),
            (Some("a1b2"), TaskStatus::Running, Some("Research themes"), Some("general-purpose"))
        );

        let done = agents(&[
            AGENT_START,
            AGENT_LAUNCHED,
            r#"{"type":"queue-operation","operation":"enqueue","timestamp":"t3","content":"<task-notification>\n<task-id>a1b2</task-id>\n<tool-use-id>tu7</tool-use-id>\n<status>completed</status>\n</task-notification>"}"#,
        ]);
        assert_eq!((done[0].status, done[0].ended_at.as_deref()), (TaskStatus::Completed, Some("t3")));

        let stopped = agents(&[
            AGENT_START,
            AGENT_LAUNCHED,
            r#"{"type":"assistant","timestamp":"t4","message":{"content":[{"type":"tool_use","id":"tu8","name":"TaskStop","input":{"task_id":"a1b2"}}]}}"#,
        ]);
        assert_eq!(stopped[0].status, TaskStatus::Killed);
        assert!(feed(&[AGENT_START, AGENT_LAUNCHED]).is_empty());
    }

    #[test]
    fn marks_a_finished_agent_running_again_when_it_is_messaged() {
        const DONE: &str = r#"{"type":"queue-operation","timestamp":"t3","content":"<task-notification><task-id>a1b2</task-id><status>completed</status></task-notification>"}"#;
        let resumed = agents(&[
            AGENT_START,
            AGENT_LAUNCHED,
            DONE,
            r#"{"type":"assistant","timestamp":"t6","message":{"content":[{"type":"tool_use","id":"tu9","name":"SendMessage","input":{"to":"a1b2","message":"one more"}}]}}"#,
        ]);
        assert_eq!(
            (resumed[0].status, resumed[0].started_at.as_deref(), resumed[0].ended_at.as_deref()),
            (TaskStatus::Running, Some("t6"), None)
        );

        let peer = agents(&[
            AGENT_START,
            AGENT_LAUNCHED,
            DONE,
            r#"{"type":"assistant","timestamp":"t6","message":{"content":[{"type":"tool_use","id":"tu9","name":"SendMessage","input":{"to":"my-files-bd","message":"hi"}}]}}"#,
        ]);
        assert_eq!(peer[0].status, TaskStatus::Completed);
    }

    #[test]
    fn finishes_agents_by_tool_call_when_their_id_was_never_seen() {
        let done = agents(&[
            AGENT_START,
            r#"{"type":"queue-operation","timestamp":"t3","content":"<task-notification><task-id>zz9</task-id><tool-use-id>tu7</tool-use-id><status>failed</status></task-notification>"}"#,
        ]);
        assert_eq!((done[0].status, done[0].ended_at.as_deref()), (TaskStatus::Failed, Some("t3")));
    }

    #[test]
    fn finishes_foreground_agents_with_their_result() {
        let launched = AGENT_LAUNCHED.replace(r#""toolUseResult":{"isAsync":true,"status":"async_launched","agentId":"a1b2"},"#, "");
        let from_text = agents(&[AGENT_START, &launched]);
        assert_eq!((from_text[0].agent_id.as_deref(), from_text[0].status), (Some("a1b2"), TaskStatus::Running));

        let failed = agents(&[
            AGENT_START,
            r#"{"type":"user","timestamp":"t5","toolUseResult":{"status":"completed","agentId":"a9"},"message":{"content":[{"type":"tool_result","tool_use_id":"tu7","is_error":true,"content":"boom"}]}}"#,
        ]);
        assert_eq!((failed[0].agent_id.as_deref(), failed[0].status, failed[0].ended_at.as_deref()), (Some("a9"), TaskStatus::Failed, Some("t5")));
    }

    #[test]
    fn falls_back_to_the_id_in_the_result_text() {
        let result = RESULT.replace(r#""toolUseResult":{"backgroundTaskId":"bg1"},"#, "");
        let tasks = feed(&[START, &result]);
        assert_eq!(tasks[0].id, "bg1");
    }
}
