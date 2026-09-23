
use std::{
    collections::{HashMap, VecDeque},
    io::{BufRead, BufReader, Read, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc,
    },
    thread,
    time::Duration,
};

use anyhow::{anyhow, bail, Context};
use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Value};

use crate::{
    claude_config::{self, ResolvedServer},
    util::hidden,
    wsl,
};

const PROTOCOL_VERSION: &str = "2025-06-18";
const INIT_TIMEOUT: Duration = Duration::from_secs(60);
const CALL_TIMEOUT: Duration = Duration::from_secs(120);
const STDERR_LINES: usize = 30;

type Pending = Arc<Mutex<HashMap<u64, mpsc::Sender<Value>>>>;

enum Transport {
    Stdio {
        child: Mutex<Child>,
        stdin: Mutex<ChildStdin>,
        pending: Pending,
        stderr: Arc<Mutex<VecDeque<String>>>,
    },
    Http {
        url: String,
        headers: Vec<(String, String)>,
        agent: ureq::Agent,
        session: Mutex<Option<String>>,
    },
}

struct Client {
    transport: Transport,
    next_id: AtomicU64,
    info: Mutex<Option<Value>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Description {
    server_info: Value,
    instructions: Option<String>,
    tools: Vec<Value>,
    resources: Vec<Value>,
    prompts: Vec<Value>,
}

#[derive(Default)]
pub struct McpManager {
    clients: Mutex<HashMap<String, Arc<Client>>>,
}

fn key(cwd: &str, id: &str) -> String {
    format!("{}|{id}", cwd.to_lowercase())
}

impl McpManager {
    fn client(&self, cwd: &str, id: &str) -> anyhow::Result<Arc<Client>> {
        let key = key(cwd, id);
        if let Some(client) = self.clients.lock().get(&key).filter(|c| c.alive()).cloned() {
            return Ok(client);
        }
        let server = claude_config::resolve_server(Path::new(cwd), id)?;
        let client = Arc::new(Client::start(&server, cwd)?);
        if let Err(error) = client.initialize() {
            client.shutdown();
            return Err(error);
        }
        if let Some(old) = self.clients.lock().insert(key, client.clone()) {
            old.shutdown();
        }
        Ok(client)
    }

    pub fn describe(&self, cwd: &str, id: &str) -> anyhow::Result<Description> {
        let client = self.client(cwd, id)?;
        let result = (|| {
            let info = client.info.lock().clone().unwrap_or(Value::Null);
            let caps = info.get("capabilities").cloned().unwrap_or(Value::Null);
            let list = |method: &str, field: &str| -> anyhow::Result<Vec<Value>> {
                let mut items = Vec::new();
                let mut cursor: Option<String> = None;
                for _ in 0..20 {
                    let params = cursor.as_ref().map_or(json!({}), |c| json!({ "cursor": c }));
                    let page = client.request(method, params, CALL_TIMEOUT)?;
                    items.extend(page.get(field).and_then(Value::as_array).cloned().unwrap_or_default());
                    cursor = page.get("nextCursor").and_then(Value::as_str).map(str::to_string);
                    if cursor.is_none() {
                        break;
                    }
                }
                Ok(items)
            };
            let optional = |cap: &str, method: &str, field: &str| {
                if caps.get(cap).is_some() { list(method, field).unwrap_or_default() } else { Vec::new() }
            };
            Ok(Description {
                tools: if caps.get("tools").is_some() || caps.is_null() { list("tools/list", "tools")? } else { Vec::new() },
                resources: optional("resources", "resources/list", "resources"),
                prompts: optional("prompts", "prompts/list", "prompts"),
                instructions: info.get("instructions").and_then(Value::as_str).map(str::to_string),
                server_info: info.get("serverInfo").cloned().unwrap_or(Value::Null),
            })
        })();
        if result.is_err() {
            self.disconnect(cwd, id);
        }
        result
    }

    pub fn call(&self, cwd: &str, id: &str, tool: &str, arguments: Value) -> anyhow::Result<Value> {
        let client = self.client(cwd, id)?;
        client.request("tools/call", json!({ "name": tool, "arguments": arguments }), CALL_TIMEOUT)
    }

    pub fn read_resource(&self, cwd: &str, id: &str, uri: &str) -> anyhow::Result<Value> {
        self.client(cwd, id)?.request("resources/read", json!({ "uri": uri }), CALL_TIMEOUT)
    }

    pub fn disconnect(&self, cwd: &str, id: &str) {
        if let Some(client) = self.clients.lock().remove(&key(cwd, id)) {
            client.shutdown();
        }
    }

    pub fn shutdown_all(&self) {
        for (_, client) in self.clients.lock().drain() {
            client.shutdown();
        }
    }
}

fn resolve_program(command: &str) -> String {
    which::which(command).map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|_| command.to_string())
}

fn kill_tree(pid: u32) {
    #[cfg(windows)]
    {
        let _ = hidden(Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
}

impl Client {
    fn start(server: &ResolvedServer, cwd: &str) -> anyhow::Result<Self> {
        let config = &server.config;
        let env = claude_config::server_env(server);
        let root = server.plugin_root.as_deref();
        let get = |k: &str| config.get(k).and_then(Value::as_str).map(|s| claude_config::expand(s, &env, root));
        let transport = get("type").unwrap_or_else(|| if config.contains_key("url") { "http".into() } else { "stdio".into() });
        let transport = match transport.as_str() {
            "stdio" => Self::stdio(server, cwd, &env)?,
            "http" | "streamable-http" => {
                let url = get("url").context("server has no url")?;
                let headers = config
                    .get("headers")
                    .and_then(Value::as_object)
                    .map(|m| {
                        m.iter()
                            .filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), claude_config::expand(v, &env, root))))
                            .collect()
                    })
                    .unwrap_or_default();
                let agent = ureq::Agent::config_builder()
                    .timeout_global(Some(CALL_TIMEOUT))
                    .http_status_as_error(false)
                    .build()
                    .into();
                Transport::Http { url, headers, agent, session: Mutex::new(None) }
            }
            "sse" => bail!("Legacy SSE servers aren't supported here yet — Claude Code can still use it."),
            other => bail!("Unknown MCP transport \"{other}\""),
        };
        Ok(Self { transport, next_id: AtomicU64::new(1), info: Mutex::new(None) })
    }

    fn stdio(server: &ResolvedServer, cwd: &str, env: &HashMap<String, String>) -> anyhow::Result<Transport> {
        let root = server.plugin_root.as_deref();
        let command = server.config.get("command").and_then(Value::as_str).context("server has no command")?;
        let command = claude_config::expand(command, env, root);
        let args: Vec<String> = server
            .config
            .get("args")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).map(|s| claude_config::expand(s, env, root)).collect())
            .unwrap_or_default();
        let mut cmd = match &server.distro {
            Some(distro) => {
                let mut cmd = Command::new("wsl.exe");
                cmd.args(["-d", distro, "--cd", &server.cwd, "-e", &wsl::login_shell(distro), "-lic"])
                    .arg("exec env \"$@\"")
                    .arg("claude-deck")
                    .args(env.iter().map(|(k, v)| format!("{k}={v}")))
                    .arg(&command)
                    .args(&args);
                cmd
            }
            None => {
                let mut cmd = Command::new(resolve_program(&command));
                cmd.args(&args).envs(env);
                if Path::new(cwd).is_dir() {
                    cmd.current_dir(cwd);
                }
                cmd
            }
        };
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = hidden(&mut cmd).spawn().with_context(|| format!("Couldn't start `{command}`"))?;
        let stdin = child.stdin.take().context("missing stdin")?;
        let stdout = child.stdout.take().context("missing stdout")?;
        let stderr_pipe = child.stderr.take().context("missing stderr")?;

        let pending: Pending = Arc::default();
        let stderr: Arc<Mutex<VecDeque<String>>> = Arc::default();
        let reader_pending = pending.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(message) = serde_json::from_str::<Value>(&line) else { continue };
                if let Some(id) = message.get("id").and_then(Value::as_u64) {
                    if message.get("method").is_none() {
                        if let Some(tx) = reader_pending.lock().remove(&id) {
                            let _ = tx.send(message);
                        }
                    }
                }
            }
            reader_pending.lock().clear();
        });
        let err_lines = stderr.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stderr_pipe);
            let mut buf = Vec::new();
            while reader.read_until(b'\n', &mut buf).map(|n| n > 0).unwrap_or(false) {
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
        Ok(Transport::Stdio { child: Mutex::new(child), stdin: Mutex::new(stdin), pending, stderr })
    }

    fn alive(&self) -> bool {
        match &self.transport {
            Transport::Stdio { child, .. } => child.lock().try_wait().map(|s| s.is_none()).unwrap_or(false),
            Transport::Http { .. } => true,
        }
    }

    fn shutdown(&self) {
        if let Transport::Stdio { child, .. } = &self.transport {
            let mut child = child.lock();
            if child.try_wait().map(|s| s.is_none()).unwrap_or(false) {
                kill_tree(child.id());
                let _ = child.kill();
            }
            let _ = child.wait();
        }
    }

    fn initialize(&self) -> anyhow::Result<()> {
        let info = self.request(
            "initialize",
            json!({
                "protocolVersion": PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": { "name": "claude-deck", "version": env!("CARGO_PKG_VERSION") },
            }),
            INIT_TIMEOUT,
        )?;
        *self.info.lock() = Some(info);
        self.notify("notifications/initialized")?;
        Ok(())
    }

    fn stderr_tail(&self) -> String {
        match &self.transport {
            Transport::Stdio { stderr, .. } => {
                let lines = stderr.lock();
                lines.iter().rev().take(6).rev().cloned().collect::<Vec<_>>().join("\n")
            }
            Transport::Http { .. } => String::new(),
        }
    }

    fn notify(&self, method: &str) -> anyhow::Result<()> {
        let message = json!({ "jsonrpc": "2.0", "method": method });
        match &self.transport {
            Transport::Stdio { stdin, .. } => {
                let mut stdin = stdin.lock();
                writeln!(stdin, "{message}")?;
                stdin.flush()?;
            }
            Transport::Http { .. } => {
                self.http_post(&message, None)?;
            }
        }
        Ok(())
    }

    fn request(&self, method: &str, params: Value, timeout: Duration) -> anyhow::Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        let response = match &self.transport {
            Transport::Stdio { stdin, pending, .. } => {
                let (tx, rx) = mpsc::channel();
                pending.lock().insert(id, tx);
                {
                    let mut stdin = stdin.lock();
                    if writeln!(stdin, "{message}").and_then(|_| stdin.flush()).is_err() {
                        pending.lock().remove(&id);
                        bail!("The server stopped.{}", self.with_stderr());
                    }
                }
                match rx.recv_timeout(timeout) {
                    Ok(response) => response,
                    Err(mpsc::RecvTimeoutError::Timeout) => {
                        pending.lock().remove(&id);
                        bail!("The server didn't answer {method} within {}s.{}", timeout.as_secs(), self.with_stderr());
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => bail!("The server exited.{}", self.with_stderr()),
                }
            }
            Transport::Http { .. } => self.http_post(&message, Some(id))?.ok_or_else(|| anyhow!("The server sent no response"))?,
        };
        if let Some(error) = response.get("error") {
            let text = error.get("message").and_then(Value::as_str).unwrap_or("request failed");
            bail!("{text}");
        }
        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    fn with_stderr(&self) -> String {
        let tail = self.stderr_tail();
        if tail.is_empty() { String::new() } else { format!("\n\n{tail}") }
    }

    fn http_post(&self, message: &Value, id: Option<u64>) -> anyhow::Result<Option<Value>> {
        let Transport::Http { url, headers, agent, session } = &self.transport else { unreachable!() };
        let mut request = agent
            .post(url)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", PROTOCOL_VERSION);
        for (name, value) in headers {
            request = request.header(name, value);
        }
        if let Some(session) = session.lock().as_ref() {
            request = request.header("Mcp-Session-Id", session);
        }
        let mut response = request.send(message.to_string()).map_err(|e| anyhow!("Couldn't reach {url}: {e}"))?;
        let status = response.status().as_u16();
        if let Some(value) = response.headers().get("mcp-session-id").and_then(|v| v.to_str().ok()) {
            *session.lock() = Some(value.to_string());
        }
        if status == 401 || status == 403 {
            bail!("This server needs you to sign in. Connect it once from Claude Code (/mcp) — Deck can't reuse that login.");
        }
        let content_type = response
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_lowercase();
        let mut body = String::new();
        response.body_mut().as_reader().take(32 * 1024 * 1024).read_to_string(&mut body)?;
        if !(200..300).contains(&status) {
            bail!("HTTP {status}: {}", body.chars().take(300).collect::<String>());
        }
        let Some(id) = id else { return Ok(None) };
        if content_type.contains("text/event-stream") {
            let mut data = String::new();
            for line in body.lines().chain(std::iter::once("")) {
                if let Some(chunk) = line.strip_prefix("data:") {
                    data.push_str(chunk.trim_start());
                } else if line.is_empty() && !data.is_empty() {
                    if let Ok(value) = serde_json::from_str::<Value>(&data) {
                        if value.get("id").and_then(Value::as_u64) == Some(id) {
                            return Ok(Some(value));
                        }
                    }
                    data.clear();
                }
            }
            bail!("The server's event stream ended without a response");
        }
        if body.trim().is_empty() {
            return Ok(None);
        }
        Ok(Some(serde_json::from_str(&body).context("The server returned invalid JSON")?))
    }
}
