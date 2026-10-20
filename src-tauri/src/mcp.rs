mod http;
mod stdio;

use std::{
    io::Write,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc,
    },
    time::{Duration, Instant},
};

use anyhow::bail;
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};

use crate::{
    agent_config::{self, ResolvedServer, Transport},
    pool::{server_key, Pool},
};
use http::{http_transport, HttpReply, HttpTransport};
use stdio::{spawn_stdio, StdioTransport};

const PROTOCOL_VERSION: &str = "2025-06-18";
const INIT_TIMEOUT: Duration = Duration::from_secs(60);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
const MAX_LIST_PAGES: usize = 20;
const STDERR_TAIL_LINES: usize = 6;

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

fn is_valid_reply(message: &Value) -> bool {
    message.get("jsonrpc").and_then(Value::as_str) == Some("2.0")
        && message.get("method").is_none()
        && (message.get("result").is_some() || message.get("error").is_some())
}

impl Client {
    fn start(server: &ResolvedServer) -> anyhow::Result<Self> {
        let launch = agent_config::launch(server);
        let connection = match &launch.transport {
            Transport::Stdio => Connection::Stdio(spawn_stdio(server, &launch)?),
            Transport::Http => Connection::Http(http_transport(&launch)?),
            Transport::Sse => bail!("Legacy SSE servers aren't supported here yet. Claude Code can still use it."),
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
            for _ in 0..MAX_LIST_PAGES {
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
                let tail = lines.iter().rev().take(STDERR_TAIL_LINES).rev().cloned().collect::<Vec<_>>().join("\n");
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

}
