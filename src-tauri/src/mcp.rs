use std::{
    collections::{HashMap, VecDeque},
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};

use anyhow::{anyhow, bail, Context};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};

use crate::{
    agent_config::{self, url_host, Launch, ResolvedServer, Transport},
    pool::{server_key, Pool},
    process::Managed,
    util::{hidden, http_agent, wslenv_with},
    wsl,
};

const PROTOCOL_VERSION: &str = "2025-06-18";
const INIT_TIMEOUT: Duration = Duration::from_secs(60);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
const STDERR_LINES: usize = 30;
const MAX_BODY_BYTES: u64 = 32 * 1024 * 1024;

type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>;

struct StdioTransport {
    process: Managed,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Pending,
    stderr: Arc<Mutex<VecDeque<String>>>,
    closed: Arc<AtomicBool>,
}

struct HttpTransport {
    url: String,
    headers: Vec<(String, String)>,
    agent: ureq::Agent,
    session: Mutex<Option<String>>,
}

enum Connection {
    Stdio(StdioTransport),
    Http(HttpTransport),
}

struct Client {
    connection: Connection,
    next_id: AtomicU64,
    info: Mutex<Option<Value>>,
    last_used: Mutex<Instant>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Description {
    server_info: Value,
    tools: Vec<Value>,
    resources: Vec<Value>,
    prompts: Vec<Value>,
}

#[derive(Default)]
pub struct McpManager {
    clients: Pool<Client>,
}

impl McpManager {
    fn client(&self, cwd: &str, id: &str) -> anyhow::Result<Arc<Client>> {
        self.clients.get(&server_key(cwd, id), Client::alive, || {
            let server = agent_config::resolve_server(cwd, id)?;
            let client = Client::start(&server)?;
            client.initialize()?;
            Ok(client)
        })
    }

    pub fn describe(&self, cwd: &str, id: &str) -> anyhow::Result<Description> {
        let client = self.client(cwd, id)?;
        let result = client.describe();
        if result.is_err() {
            let stale = self.clients.remove_if(&server_key(cwd, id), |c| Arc::ptr_eq(c, &client));
            drop(stale);
        }
        result
    }

    pub fn call(&self, cwd: &str, id: &str, tool: &str, arguments: Value) -> anyhow::Result<Value> {
        self.client(cwd, id)?.request("tools/call", json!({ "name": tool, "arguments": arguments }), CALL_TIMEOUT)
    }

    pub fn read_resource(&self, cwd: &str, id: &str, uri: &str) -> anyhow::Result<Value> {
        self.client(cwd, id)?.request("resources/read", json!({ "uri": uri }), CALL_TIMEOUT)
    }

    pub fn disconnect(&self, cwd: &str, id: &str) {
        if let Some(client) = self.clients.remove(&server_key(cwd, id)) {
            client.shutdown();
        }
    }

    pub fn shutdown_all(&self) {
        for client in self.clients.drain() {
            client.shutdown();
        }
    }

    pub fn shutdown_idle(&self, idle: Duration) {
        for client in self.clients.evict(|c| c.last_used.lock().elapsed() > idle) {
            client.shutdown();
        }
    }
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
            cmd.env("WSLENV", wslenv_with(names.iter().map(|k| format!("{k}/u"))));
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

fn is_valid_reply(message: &Value) -> bool {
    message.get("jsonrpc").and_then(Value::as_str) == Some("2.0")
        && message.get("method").is_none()
        && (message.get("result").is_some() || message.get("error").is_some())
}

fn answer_server_request(message: &Value, stdin: &Mutex<ChildStdin>) {
    let (Some(method), Some(id)) = (message.get("method").and_then(Value::as_str), message.get("id").filter(|id| !id.is_null())) else {
        return;
    };
    let reply = if method == "ping" {
        json!({ "jsonrpc": "2.0", "id": id, "result": {} })
    } else {
        json!({ "jsonrpc": "2.0", "id": id, "error": { "code": -32601, "message": format!("{method} isn't supported by Agent Deck") } })
    };
    let mut stdin = stdin.lock();
    let _ = writeln!(stdin, "{reply}").and_then(|_| stdin.flush());
}

fn spawn_stdio(server: &ResolvedServer, launch: &Launch) -> anyhow::Result<StdioTransport> {
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
    let (reader_pending, reader_stdin, reader_closed) = (pending.clone(), stdin.clone(), closed.clone());
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
    let err_lines = stderr.clone();
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
    Ok(StdioTransport { process, stdin, pending, stderr, closed })
}

fn http_transport(launch: &Launch) -> anyhow::Result<HttpTransport> {
    let url = launch.url.clone().filter(|u| !u.is_empty()).context("server has no url")?;
    Ok(HttpTransport { url, headers: launch.headers.clone(), agent: http_agent(CALL_TIMEOUT), session: Mutex::new(None) })
}

fn sse_message(reader: impl BufRead, id: u64) -> anyhow::Result<Option<Value>> {
    let mut data = String::new();
    for line in reader.lines() {
        let line = line?;
        if let Some(chunk) = line.strip_prefix("data:") {
            if !data.is_empty() {
                data.push('\n');
            }
            data.push_str(chunk.strip_prefix(' ').unwrap_or(chunk));
            continue;
        }
        if line.is_empty() && !data.is_empty() {
            let event = std::mem::take(&mut data);
            if let Ok(value) = serde_json::from_str::<Value>(&event) {
                if value.get("id").and_then(Value::as_u64) == Some(id) && is_valid_reply(&value) {
                    return Ok(Some(value));
                }
            }
        }
    }
    if let Ok(value) = serde_json::from_str::<Value>(&data) {
        if value.get("id").and_then(Value::as_u64) == Some(id) {
            return Ok(Some(value));
        }
    }
    Ok(None)
}

enum HttpReply {
    Message(Option<Value>),
    SessionExpired,
}

impl HttpTransport {
    fn post(&self, message: &Value, id: Option<u64>) -> anyhow::Result<HttpReply> {
        let host = url_host(&self.url);
        let mut request = self
            .agent
            .post(&self.url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", PROTOCOL_VERSION);
        for (name, value) in &self.headers {
            request = request.header(name, value);
        }
        let session = self.session.lock().clone();
        if let Some(session) = &session {
            request = request.header("Mcp-Session-Id", session);
        }
        let mut response = request.send(message.to_string()).map_err(|e| anyhow!("Couldn't reach {host}: {}", describe_http_error(&e)))?;
        let status = response.status().as_u16();
        if let Some(value) = response.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()) {
            *self.session.lock() = Some(value.to_string());
        }
        if status == 404 && session.is_some() {
            *self.session.lock() = None;
            return Ok(HttpReply::SessionExpired);
        }
        if status == 401 || status == 403 {
            bail!("This server needs you to sign in. Connect it once from Claude Code (/mcp) — Deck can't reuse that login.");
        }
        let content_type = response.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or_default().to_lowercase();
        let body = response.body_mut().as_reader().take(MAX_BODY_BYTES);
        if !(200..300).contains(&status) {
            let mut text = String::new();
            let _ = BufReader::new(body).take(4096).read_to_string(&mut text);
            bail!("HTTP {status} from {host}: {}", text.chars().take(300).collect::<String>());
        }
        let Some(id) = id else { return Ok(HttpReply::Message(None)) };
        if content_type.contains("text/event-stream") {
            return match sse_message(BufReader::new(body), id)? {
                Some(value) => Ok(HttpReply::Message(Some(value))),
                None => bail!("The server's event stream ended without a response"),
            };
        }
        let mut text = String::new();
        BufReader::new(body).read_to_string(&mut text)?;
        if text.trim().is_empty() {
            return Ok(HttpReply::Message(None));
        }
        Ok(HttpReply::Message(Some(serde_json::from_str(&text).context("The server returned invalid JSON")?)))
    }
}

fn describe_http_error(error: &ureq::Error) -> String {
    match error {
        ureq::Error::BadUri(_) => "the address isn't valid".into(),
        ureq::Error::Timeout(_) => "the connection timed out".into(),
        ureq::Error::HostNotFound => "the host wasn't found".into(),
        other => other.to_string(),
    }
}

impl Client {
    fn start(server: &ResolvedServer) -> anyhow::Result<Self> {
        let launch = agent_config::launch(server);
        let connection = match &launch.transport {
            Transport::Stdio => Connection::Stdio(spawn_stdio(server, &launch)?),
            Transport::Http => Connection::Http(http_transport(&launch)?),
            Transport::Sse => bail!("Legacy SSE servers aren't supported here yet — Claude Code can still use it."),
            Transport::Unknown(other) => bail!("Unknown MCP transport \"{other}\""),
        };
        Ok(Self { connection, next_id: AtomicU64::new(1), info: Mutex::new(None), last_used: Mutex::new(Instant::now()) })
    }

    fn alive(&self) -> bool {
        match &self.connection {
            Connection::Stdio(stdio) => !stdio.closed.load(Ordering::SeqCst) && stdio.process.running(),
            Connection::Http(_) => true,
        }
    }

    fn shutdown(&self) {
        if let Connection::Stdio(stdio) = &self.connection {
            let _ = stdio.process.stop();
        }
    }

    fn initialize(&self) -> anyhow::Result<()> {
        let params = json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "agent-deck", "version": env!("CARGO_PKG_VERSION") },
        });
        let info = self.send_request("initialize", params, INIT_TIMEOUT)?;
        *self.info.lock() = Some(info);
        self.notify("notifications/initialized")
    }

    fn describe(&self) -> anyhow::Result<Description> {
        let info = self.info.lock().clone().unwrap_or(Value::Null);
        let caps = info.get("capabilities").cloned().unwrap_or(Value::Null);
        let list = |method: &str, field: &str| -> anyhow::Result<Vec<Value>> {
            let mut items = Vec::new();
            let mut cursor: Option<String> = None;
            for _ in 0..20 {
                let params = cursor.as_ref().map_or(json!({}), |c| json!({ "cursor": c }));
                let page = self.request(method, params, CALL_TIMEOUT)?;
                items.extend(page.get(field).and_then(Value::as_array).cloned().unwrap_or_default());
                cursor = page.get("nextCursor").and_then(Value::as_str).map(str::to_string);
                if cursor.is_none() {
                    break;
                }
            }
            Ok(items)
        };
        let optional = |cap: &str, method: &str, field: &str| if caps.get(cap).is_some() { list(method, field).unwrap_or_default() } else { Vec::new() };
        Ok(Description {
            tools: if caps.get("tools").is_some() || caps.is_null() { list("tools/list", "tools")? } else { Vec::new() },
            resources: optional("resources", "resources/list", "resources"),
            prompts: optional("prompts", "prompts/list", "prompts"),
            server_info: info.get("serverInfo").cloned().unwrap_or(Value::Null),
        })
    }

    fn stderr_tail(&self) -> String {
        match &self.connection {
            Connection::Stdio(stdio) => {
                let lines = stdio.stderr.lock();
                let tail = lines.iter().rev().take(6).rev().cloned().collect::<Vec<_>>().join("\n");
                if tail.is_empty() { String::new() } else { format!("\n\n{tail}") }
            }
            Connection::Http(_) => String::new(),
        }
    }

    fn notify(&self, method: &str) -> anyhow::Result<()> {
        let message = json!({ "jsonrpc": "2.0", "method": method });
        match &self.connection {
            Connection::Stdio(stdio) => {
                let mut stdin = stdio.stdin.lock();
                writeln!(stdin, "{message}")?;
                stdin.flush()?;
            }
            Connection::Http(http) => {
                http.post(&message, None)?;
            }
        }
        Ok(())
    }

    fn request(&self, method: &str, params: Value, timeout: Duration) -> anyhow::Result<Value> {
        *self.last_used.lock() = Instant::now();
        let _touch = Touch(&self.last_used);
        match self.send_request(method, params.clone(), timeout) {
            Err(error) if error.is::<SessionExpired>() => {
                self.initialize()?;
                self.send_request(method, params, timeout)
            }
            other => other,
        }
    }

    fn send_request(&self, method: &str, params: Value, timeout: Duration) -> anyhow::Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let response = match &self.connection {
            Connection::Stdio(stdio) => {
                let (tx, rx) = mpsc::channel();
                stdio.pending.lock().insert(id, tx);
                let written = !stdio.closed.load(Ordering::SeqCst) && {
                    let mut stdin = stdio.stdin.lock();
                    writeln!(stdin, "{message}").and_then(|_| stdin.flush()).is_ok()
                };
                if !written {
                    stdio.pending.lock().remove(&id);
                    bail!("The server stopped.{}", self.stderr_tail());
                }
                match rx.recv_timeout(timeout) {
                    Ok(response) => response,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        stdio.pending.lock().remove(&id);
                        bail!("The server didn't answer {method} within {}s.{}", timeout.as_secs(), self.stderr_tail());
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => bail!("The server exited.{}", self.stderr_tail()),
                }
            }
            Connection::Http(http) => match http.post(&message, Some(id))? {
                HttpReply::Message(Some(value)) => value,
                HttpReply::Message(None) => bail!("The server sent no response"),
                HttpReply::SessionExpired if method != "initialize" => return Err(SessionExpired.into()),
                HttpReply::SessionExpired => bail!("The server rejected the session"),
            },
        };
        if let Some(error) = response.get("error") {
            bail!("{}", error.get("message").and_then(Value::as_str).unwrap_or("request failed"));
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }
}

struct Touch<'a>(&'a Mutex<Instant>);

impl Drop for Touch<'_> {
    fn drop(&mut self) {
        *self.0.lock() = Instant::now();
    }
}

#[derive(Debug)]
struct SessionExpired;

impl std::fmt::Display for SessionExpired {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("The server's session expired")
    }
}

impl std::error::Error for SessionExpired {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_json_rpc_replies() {
        assert!(is_valid_reply(&json!({"jsonrpc":"2.0","id":1,"result":{}})));
        assert!(is_valid_reply(&json!({"jsonrpc":"2.0","id":1,"error":{"code":1}})));
        assert!(!is_valid_reply(&json!({"id":1,"result":{}})));
        assert!(!is_valid_reply(&json!({"jsonrpc":"2.0","id":1,"level":"info"})));
        assert!(!is_valid_reply(&json!({"jsonrpc":"2.0","id":1,"method":"ping"})));
    }

    #[test]
    fn reads_the_matching_sse_event_without_waiting_for_the_stream_to_end() {
        let stream = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"log\"}\n\ndata: {\"jsonrpc\":\"2.0\",\"id\":7,\n data:\"result\":{\"ok\":true}}\n\n";
        let stream = stream.replace("\n data:", "\ndata:");
        let reader = std::io::Cursor::new(format!("{stream}data: never-ending"));
        let value = sse_message(BufReader::new(reader), 7).unwrap().unwrap();
        assert_eq!(value["result"]["ok"], true);
    }

    #[test]
    #[ignore]
    fn talks_to_a_noisy_stdio_server() {
        let script = std::env::temp_dir().join(format!("deck-fake-mcp-{}.cjs", std::process::id()));
        std::fs::write(&script, FAKE_SERVER).unwrap();
        let config = serde_json::from_value(json!({ "command": "node", "args": [script.to_string_lossy()] })).unwrap();
        let server = ResolvedServer { config, plugin_root: None, distro: None, cwd: std::env::temp_dir().to_string_lossy().to_string() };
        let client = Client::start(&server).unwrap();
        client.initialize().unwrap();
        let description = client.describe().unwrap();
        assert_eq!(description.tools.len(), 1);
        let reply = client.request("tools/call", json!({ "name": "echo", "arguments": { "x": 1 } }), CALL_TIMEOUT).unwrap();
        assert_eq!(reply["echoed"]["x"], 1);
        assert_eq!(reply["pinged"], true);
        assert!(client.request("unknown/method", json!({}), CALL_TIMEOUT).is_err());
        assert!(client.alive());
        client.shutdown();
        assert!(!client.alive());
        assert!(client.request("tools/list", json!({}), Duration::from_secs(2)).is_err());
        let _ = std::fs::remove_file(&script);
    }

    const FAKE_SERVER: &str = r#"const readline = require("readline");
const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n");
process.stdout.write(Buffer.from([0x62, 0x61, 0x64, 0xe9, 0x0a]));
process.stdout.write("not json at all\n");
let pinged = false;
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined && msg.method) return;
  if (msg.method === undefined) {
    if (msg.id === "srv-ping") pinged = msg.result !== undefined;
    return;
  }
  out({ id: msg.id, level: "info", note: "log line that looks like a reply" });
  if (msg.method === "initialize") {
    out({ jsonrpc: "2.0", id: "srv-ping", method: "ping" });
    return out({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
  }
  if (msg.method === "tools/list") return out({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo" }] } });
  if (msg.method === "tools/call") return out({ jsonrpc: "2.0", id: msg.id, result: { echoed: msg.params.arguments, pinged } });
  out({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "nope" } });
});
"#;

    #[test]
    fn quotes_for_posix_and_fish_shells() {
        assert_eq!(crate::util::sh_quote("it's"), r"'it'\''s'");
        assert!(valid_env_name("API_KEY") && !valid_env_name("1X") && !valid_env_name("A-B"));
    }
}
