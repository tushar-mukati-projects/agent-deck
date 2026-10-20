use std::{
    collections::{HashMap, VecDeque},
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{ChildStderr, ChildStdin, ChildStdout, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread,
};

use anyhow::Context;
use parking_lot::Mutex;
use serde_json::{json, Value};

use super::is_valid_reply;
use crate::{
    agent_config::{Launch, ResolvedServer},
    process::Managed,
    util::hidden,
    wsl,
};

const STDERR_LINES: usize = 30;
const METHOD_NOT_FOUND: i32 = -32601;

pub(super) type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>;

pub(super) struct StdioTransport {
    pub(super) process: Managed,
    pub(super) stdin: Arc<Mutex<ChildStdin>>,
    pub(super) pending: Pending,
    pub(super) stderr: Arc<Mutex<VecDeque<String>>>,
    pub(super) closed: Arc<AtomicBool>,
}

fn valid_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn stdio_command(server: &ResolvedServer, launch: &Launch) -> anyhow::Result<Command> {
    let command = launch.command.clone().filter(|c| !c.is_empty()).context("server has no command")?;
    Ok(match &server.distro {
        Some(distro) => {
            let mut cmd = wsl::login_command(distro, &server.cwd, &command, &launch.args);
            let names: Vec<&String> = launch.env.keys().filter(|k| valid_env_name(k)).collect();
            for name in &names {
                cmd.env(name, &launch.env[*name]);
            }
            let existing = std::env::var("WSLENV").unwrap_or_default();
            let forwarded = names.iter().map(|k| format!("{k}/u")).chain((!existing.is_empty()).then_some(existing)).collect::<Vec<_>>();
            cmd.env("WSLENV", forwarded.join(":"));
            cmd
        }
        None => {
            let mut cmd = Command::new(which::which(&command).map(|p| p.to_string_lossy().to_string()).unwrap_or(command));
            cmd.args(&launch.args).envs(&launch.env);
            if Path::new(&server.cwd).is_dir() {
                cmd.current_dir(&server.cwd);
            }
            cmd
        }
    })
}

fn answer_server_request(message: &Value, stdin: &Mutex<ChildStdin>) {
    let (Some(method), Some(id)) = (message.get("method").and_then(Value::as_str), message.get("id").filter(|id| !id.is_null())) else {
        return;
    };
    let reply = if method == "ping" {
        json!({ "jsonrpc": "2.0", "id": id, "result": {} })
    } else {
        json!({ "jsonrpc": "2.0", "id": id, "error": { "code": METHOD_NOT_FOUND, "message": format!("{method} isn't supported by Agent Deck") } })
    };
    let mut stdin = stdin.lock();
    let _ = writeln!(stdin, "{reply}").and_then(|_| stdin.flush());
}

pub(super) fn spawn_stdio(server: &ResolvedServer, launch: &Launch) -> anyhow::Result<StdioTransport> {
    let mut cmd = stdio_command(server, launch)?;
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = hidden(&mut cmd).spawn().with_context(|| format!("Couldn't start `{}`", launch.command.as_deref().unwrap_or_default()))?;
    let stdin = Arc::new(Mutex::new(child.stdin.take().context("missing stdin")?));
    let stdout = child.stdout.take().context("missing stdout")?;
    let stderr_pipe = child.stderr.take().context("missing stderr")?;
    let process = Managed::new(child)?;

    let pending: Pending = Arc::default();
    let stderr: Arc<Mutex<VecDeque<String>>> = Arc::default();
    let closed = Arc::new(AtomicBool::new(false));
    read_replies(stdout, pending.clone(), stdin.clone(), closed.clone());
    keep_stderr_tail(stderr_pipe, stderr.clone());
    Ok(StdioTransport { process, stdin, pending, stderr, closed })
}

fn read_replies(stdout: ChildStdout, reader_pending: Pending, reader_stdin: Arc<Mutex<ChildStdin>>, reader_closed: Arc<AtomicBool>) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = Vec::new();
        while reader.read_until(b'\n', &mut line).is_ok_and(|n| n > 0) {
            if let Ok(message) = serde_json::from_slice::<Value>(&line) {
                if is_valid_reply(&message) {
                    let sender = message.get("id").and_then(Value::as_u64).and_then(|id| reader_pending.lock().remove(&id));
                    if let Some(sender) = sender {
                        let _ = sender.send(message);
                    }
                } else {
                    answer_server_request(&message, &reader_stdin);
                }
            }
            line.clear();
        }
        reader_closed.store(true, Ordering::SeqCst);
        reader_pending.lock().clear();
    });
}

fn keep_stderr_tail(stderr_pipe: ChildStderr, err_lines: Arc<Mutex<VecDeque<String>>>) {
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr_pipe);
        let mut buf = Vec::new();
        while reader.read_until(b'\n', &mut buf).is_ok_and(|n| n > 0) {
            let line = String::from_utf8_lossy(&buf).trim_end().to_string();
            buf.clear();
            if line.is_empty() {
                continue;
            }
            let mut lines = err_lines.lock();
            if lines.len() == STDERR_LINES {
                lines.pop_front();
            }
            lines.push_back(line);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::sh_quote;

    #[test]
    fn quotes_for_posix_and_fish_shells() {
        assert_eq!(sh_quote("it's"), r"'it'\''s'");
        assert!(valid_env_name("API_KEY") && !valid_env_name("1X") && !valid_env_name("A-B"));
    }
}
