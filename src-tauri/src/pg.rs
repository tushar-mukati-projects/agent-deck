use std::{
    collections::HashMap,
    io::{self, Read, Write},
    net::{Shutdown, TcpListener, TcpStream as StdTcpStream},
    process::{Command, Stdio},
    sync::Arc,
    thread,
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context};
use base64::Engine;
use futures_util::StreamExt;
use parking_lot::Mutex;
use postgres_native_tls::{MakeTlsConnector, TlsConnector};
use serde::Serialize;
use tokio::net::TcpStream;
use tokio_postgres::{config::Host, tls::MakeTlsConnect, CancelToken, Client, Config, SimpleQueryMessage};

use crate::{
    agent_config::{self, Launch, ResolvedServer},
    pool::{server_key, Pool},
    process::Managed,
    util::hidden,
};

const MAX_ROWS: usize = 2000;
const STATEMENT_TIMEOUT: Duration = Duration::from_secs(60);
const QUERY_GRACE: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const IDLE_CHECK_AFTER: Duration = Duration::from_secs(30);
const VALIDATE_TIMEOUT: Duration = Duration::from_secs(5);

const URL_KEYS: &[&str] = &[
    "DATABASE_URL",
    "DATABASE_URI",
    "POSTGRES_URL",
    "POSTGRES_URI",
    "POSTGRESQL_URL",
    "POSTGRES_CONNECTION_STRING",
    "PG_CONNECTION_STRING",
    "PG_URL",
    "PGURL",
    "DB_URL",
    "DB_URI",
];
const HOST_KEYS: &[&str] = &["PG_HOST", "PGHOST", "POSTGRES_HOST", "POSTGRESQL_HOST"];
const GENERIC_HOST_KEYS: &[&str] = &["DB_HOST", "DATABASE_HOST"];
const PORT_KEYS: &[&str] = &["PG_PORT", "PGPORT", "POSTGRES_PORT", "DB_PORT", "DATABASE_PORT"];
const USER_KEYS: &[&str] = &["PG_USER", "PGUSER", "POSTGRES_USER", "DB_USER", "DATABASE_USER"];
const PASSWORD_KEYS: &[&str] = &["PG_PASSWORD", "PGPASSWORD", "POSTGRES_PASSWORD", "DB_PASSWORD", "DATABASE_PASSWORD"];
const DATABASE_KEYS: &[&str] = &["PG_DATABASE", "PGDATABASE", "POSTGRES_DB", "POSTGRES_DATABASE", "DB_NAME", "DATABASE_NAME"];

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    columns: Vec<String>,
    rows: Vec<Vec<Option<String>>>,
    row_count: u64,
    truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryOutput {
    results: Vec<QueryResult>,
    elapsed_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    host: String,
    port: u16,
    database: String,
    user: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verify {
    Nothing,
    Chain,
    Full,
}

pub struct Target {
    config: Config,
    host: String,
    port: u16,
    verify: Verify,
}

fn first<'a>(env: &'a HashMap<String, String>, names: &[&str]) -> Option<&'a String> {
    names.iter().find_map(|n| env.get(*n).filter(|v| !v.is_empty()))
}

fn is_pg_url(value: &str) -> bool {
    let lower = value.trim().to_ascii_lowercase();
    lower.starts_with("postgres://") || lower.starts_with("postgresql://")
}

fn strip_verification(connection: &str) -> (String, Verify) {
    let lower = connection.to_ascii_lowercase();
    for (mode, verify) in [("sslmode=verify-full", Verify::Full), ("sslmode=verify-ca", Verify::Chain)] {
        if let Some(index) = lower.find(mode) {
            return (format!("{}sslmode=require{}", &connection[..index], &connection[index + mode.len()..]), verify);
        }
    }
    (connection.to_string(), Verify::Nothing)
}

fn finish(mut config: Config, verify: Verify) -> Target {
    let statement = format!("-c statement_timeout={}", STATEMENT_TIMEOUT.as_millis());
    let options = match config.get_options().filter(|o| !o.trim().is_empty()) {
        Some(existing) => format!("{existing} {statement}"),
        None => statement,
    };
    config.options(options).connect_timeout(CONNECT_TIMEOUT);
    if config.get_application_name().is_none() {
        config.application_name("claude-deck");
    }
    #[allow(unreachable_patterns)]
    let host = config.get_hosts().iter().find_map(|h| match h {
        Host::Tcp(host) => Some(host.clone()),
        _ => None,
    });
    let port = config.get_ports().first().copied().unwrap_or(5432);
    Target { host: host.unwrap_or_else(|| "localhost".into()), port, verify, config }
}

pub fn parse_connection(connection: &str) -> anyhow::Result<Target> {
    let (connection, verify) = strip_verification(connection.trim());
    let config = connection.parse::<Config>().context("The connection string isn't valid")?;
    Ok(finish(config, verify))
}

pub fn detect(launch: &Launch, hinted: bool) -> Option<anyhow::Result<Target>> {
    let env = &launch.env;
    let url = launch.args.iter().find(|a| is_pg_url(a)).or_else(|| URL_KEYS.iter().filter_map(|k| env.get(*k)).find(|v| is_pg_url(v)));
    if let Some(url) = url {
        return Some(parse_connection(url));
    }
    let host = first(env, HOST_KEYS).or_else(|| hinted.then(|| first(env, GENERIC_HOST_KEYS)).flatten())?;
    let mut config = Config::new();
    config.host(host);
    if let Some(port) = first(env, PORT_KEYS) {
        match port.parse() {
            Ok(port) => {
                config.port(port);
            }
            Err(_) => return Some(Err(anyhow!("The database port \"{port}\" isn't a number"))),
        }
    }
    if let Some(user) = first(env, USER_KEYS) {
        config.user(user);
    }
    if let Some(password) = first(env, PASSWORD_KEYS) {
        config.password(password);
    }
    if let Some(database) = first(env, DATABASE_KEYS) {
        config.dbname(database);
    }
    Some(Ok(finish(config, Verify::Nothing)))
}

fn target_for(server: &ResolvedServer) -> anyhow::Result<Target> {
    detect(&agent_config::launch(server), true).unwrap_or_else(|| Err(anyhow!("Couldn't find database credentials in this server's config")))
}

const RELAY: &str = r#"import socket, sys, threading
s = socket.create_connection((sys.argv[1], int(sys.argv[2])), 10)
s.settimeout(None)
s.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
for name, value in (("TCP_KEEPIDLE", 30), ("TCP_KEEPINTVL", 10), ("TCP_KEEPCNT", 3)):
    if hasattr(socket, name):
        s.setsockopt(socket.IPPROTO_TCP, getattr(socket, name), value)
def upstream():
    while True:
        data = sys.stdin.buffer.read1(65536)
        if not data:
            break
        s.sendall(data)
    try:
        s.shutdown(socket.SHUT_WR)
    except OSError:
        pass
threading.Thread(target=upstream, daemon=True).start()
out = sys.stdout.buffer
while True:
    data = s.recv(65536)
    if not data:
        break
    out.write(data)
    out.flush()
"#;

struct Relay {
    process: Arc<Managed>,
    stderr: Arc<Mutex<String>>,
}

impl Relay {
    fn last_error(&self) -> Option<String> {
        self.stderr.lock().lines().rev().find(|l| !l.trim().is_empty()).map(|l| l.trim().to_string())
    }
}

fn wsl_relay(distro: &str, host: &str, port: u16) -> anyhow::Result<(StdTcpStream, Relay)> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let client = StdTcpStream::connect(listener.local_addr()?)?;
    let (bridge, _) = listener.accept()?;
    drop(listener);
    let script = format!("import base64;exec(base64.b64decode('{}'))", base64::engine::general_purpose::STANDARD.encode(RELAY));
    let mut command = Command::new("wsl.exe");
    command
        .args(["-d", distro, "-e", "python3", "-c", &script, host, &port.to_string()])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = hidden(&mut command).spawn().context("Couldn't start the WSL relay")?;
    let (mut stdin, mut stdout, mut stderr_pipe) = (
        child.stdin.take().context("missing stdin")?,
        child.stdout.take().context("missing stdout")?,
        child.stderr.take().context("missing stderr")?,
    );
    let process = Arc::new(Managed::new(child));
    let stderr: Arc<Mutex<String>> = Arc::default();
    let collected = stderr.clone();
    thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr_pipe.read_to_string(&mut text);
        collected.lock().push_str(&text);
    });
    let mut reader = bridge.try_clone()?;
    thread::spawn(move || {
        let _ = io::copy(&mut reader, &mut stdin);
    });
    let mut writer = bridge;
    let owner = process.clone();
    thread::spawn(move || {
        let _ = io::copy(&mut stdout, &mut writer);
        let _ = writer.flush();
        let _ = writer.shutdown(Shutdown::Both);
        owner.stop();
    });
    Ok((client, Relay { process, stderr }))
}

fn keep_alive(stream: &TcpStream) {
    let keepalive = socket2::TcpKeepalive::new().with_time(Duration::from_secs(30)).with_interval(Duration::from_secs(10));
    let _ = socket2::SockRef::from(stream).set_tcp_keepalive(&keepalive);
}

async fn dial(distro: Option<&str>, host: &str, port: u16) -> anyhow::Result<(TcpStream, Option<Relay>)> {
    let address = if host.eq_ignore_ascii_case("localhost") { "127.0.0.1" } else { host };
    match distro {
        Some(distro) => {
            let (stream, relay) = wsl_relay(distro, address, port)?;
            stream.set_nonblocking(true)?;
            Ok((TcpStream::from_std(stream)?, Some(relay)))
        }
        None => {
            let stream = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect((address, port)))
                .await
                .map_err(|_| anyhow!("timed out after {}s", CONNECT_TIMEOUT.as_secs()))??;
            let _ = stream.set_nodelay(true);
            keep_alive(&stream);
            Ok((stream, None))
        }
    }
}

fn tls_for(target: &Target) -> anyhow::Result<TlsConnector> {
    let mut builder = native_tls::TlsConnector::builder();
    match target.verify {
        Verify::Full => {}
        Verify::Chain => {
            builder.danger_accept_invalid_hostnames(true);
        }
        Verify::Nothing => {
            builder.danger_accept_invalid_certs(true).danger_accept_invalid_hostnames(true);
        }
    }
    let mut maker = MakeTlsConnector::new(builder.build()?);
    Ok(<MakeTlsConnector as MakeTlsConnect<TcpStream>>::make_tls_connect(&mut maker, &target.host)?)
}

pub fn describe(error: tokio_postgres::Error) -> anyhow::Error {
    match error.as_db_error() {
        Some(db) => {
            let mut text = db.message().to_string();
            if let Some(detail) = db.detail() {
                text.push_str(&format!("\n{detail}"));
            }
            if let Some(hint) = db.hint() {
                text.push_str(&format!("\nHint: {hint}"));
            }
            anyhow!(text)
        }
        None => anyhow!("{error}{}", std::error::Error::source(&error).map(|s| format!(": {s}")).unwrap_or_default()),
    }
}

struct Connection {
    client: Client,
    cancel: CancelToken,
    target: Target,
    distro: Option<String>,
    last_used: Mutex<Instant>,
    relay: Option<Relay>,
}

impl Connection {
    async fn open(server: &ResolvedServer) -> anyhow::Result<Self> {
        let target = target_for(server)?;
        let place = server.distro.as_ref().map(|d| format!(" from WSL {d}")).unwrap_or_default();
        let unreachable = |detail: String| {
            anyhow!(
                "Couldn't connect to {}:{}{place}. Is the database (or the tunnel / port-forward to it) running?\n\n{detail}",
                target.host,
                target.port
            )
        };
        let (stream, relay) = dial(server.distro.as_deref(), &target.host, target.port).await.map_err(|e| unreachable(format!("{e:#}")))?;
        let tls = tls_for(&target)?;
        let connected = tokio::time::timeout(CONNECT_TIMEOUT, target.config.connect_raw(stream, tls)).await;
        let (client, connection) = match connected {
            Ok(Ok(pair)) => pair,
            Ok(Err(error)) if error.as_db_error().is_some() => return Err(describe(error)),
            Ok(Err(error)) => {
                let detail = relay.as_ref().and_then(Relay::last_error).unwrap_or_else(|| format!("{:#}", describe(error)));
                return Err(unreachable(detail));
            }
            Err(_) => return Err(unreachable(format!("The server didn't answer within {}s", CONNECT_TIMEOUT.as_secs()))),
        };
        tauri::async_runtime::spawn(async move {
            let _ = connection.await;
        });
        Ok(Self {
            cancel: client.cancel_token(),
            client,
            target,
            distro: server.distro.clone(),
            last_used: Mutex::new(Instant::now()),
            relay,
        })
    }

    fn alive(&self) -> bool {
        !self.client.is_closed() && self.relay.as_ref().is_none_or(|r| r.process.running())
    }

    async fn valid(&self) -> bool {
        matches!(tokio::time::timeout(VALIDATE_TIMEOUT, self.client.simple_query("")).await, Ok(Ok(_)))
    }

    async fn cancel(&self) -> anyhow::Result<()> {
        let (stream, _relay) = dial(self.distro.as_deref(), &self.target.host, self.target.port).await?;
        let tls = tls_for(&self.target)?;
        tokio::time::timeout(CONNECT_TIMEOUT, self.cancel.cancel_query_raw(stream, tls))
            .await
            .map_err(|_| anyhow!("The cancel request timed out"))?
            .map_err(describe)
    }
}

async fn collect(client: &Client, sql: &str) -> Result<Vec<QueryResult>, tokio_postgres::Error> {
    let stream = client.simple_query_raw(sql).await?;
    futures_util::pin_mut!(stream);
    let mut results = Vec::new();
    let mut current = QueryResult::default();
    let mut started = false;
    while let Some(message) = stream.next().await {
        match message? {
            SimpleQueryMessage::RowDescription(columns) => {
                current.columns = columns.iter().map(|c| c.name().to_string()).collect();
                started = true;
            }
            SimpleQueryMessage::Row(row) => {
                if current.columns.is_empty() {
                    current.columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                }
                started = true;
                if current.rows.len() < MAX_ROWS {
                    current.rows.push((0..row.len()).map(|i| row.get(i).map(str::to_string)).collect());
                } else {
                    current.truncated = true;
                }
            }
            SimpleQueryMessage::CommandComplete(count) => {
                current.row_count = count;
                results.push(std::mem::take(&mut current));
                started = false;
            }
            _ => {}
        }
    }
    if started {
        results.push(current);
    }
    Ok(results)
}

#[derive(Default)]
pub struct PgManager {
    connections: Pool<Connection>,
}

impl PgManager {
    fn connection(&self, cwd: &str, id: &str) -> anyhow::Result<Arc<Connection>> {
        self.connections.get(&server_key(cwd, id), Connection::alive, || {
            let server = agent_config::resolve_server(cwd, id)?;
            tauri::async_runtime::block_on(Connection::open(&server))
        })
    }

    fn forget(&self, key: &str, connection: &Arc<Connection>) {
        drop(self.connections.remove_if(key, |c| Arc::ptr_eq(c, connection)));
    }

    pub fn info(&self, cwd: &str, id: &str) -> anyhow::Result<ConnectionInfo> {
        let target = target_for(&agent_config::resolve_server(cwd, id)?)?;
        Ok(ConnectionInfo {
            host: target.host,
            port: target.port,
            database: target.config.get_dbname().unwrap_or_default().to_string(),
            user: target.config.get_user().unwrap_or_default().to_string(),
        })
    }

    pub fn query(&self, cwd: &str, id: &str, sql: &str) -> anyhow::Result<QueryOutput> {
        let key = server_key(cwd, id);
        let mut connection = self.connection(cwd, id)?;
        let idle = connection.last_used.lock().elapsed();
        if idle > IDLE_CHECK_AFTER && !tauri::async_runtime::block_on(connection.valid()) {
            self.forget(&key, &connection);
            connection = self.connection(cwd, id)?;
        }
        *connection.last_used.lock() = Instant::now();
        let started = Instant::now();
        let outcome = tauri::async_runtime::block_on(async { tokio::time::timeout(STATEMENT_TIMEOUT + QUERY_GRACE, collect(&connection.client, sql)).await });
        *connection.last_used.lock() = Instant::now();
        match outcome {
            Ok(Ok(results)) => Ok(QueryOutput { results, elapsed_ms: started.elapsed().as_millis() as u64 }),
            Ok(Err(error)) => {
                if connection.client.is_closed() {
                    self.forget(&key, &connection);
                }
                Err(describe(error))
            }
            Err(_) => {
                let _ = tauri::async_runtime::block_on(connection.cancel());
                self.forget(&key, &connection);
                Err(anyhow!("The query didn't finish within {}s, so it was cancelled.", (STATEMENT_TIMEOUT + QUERY_GRACE).as_secs()))
            }
        }
    }

    pub fn cancel(&self, cwd: &str, id: &str) -> anyhow::Result<()> {
        let Some(connection) = self.connections.peek(&server_key(cwd, id)) else { return Ok(()) };
        tauri::async_runtime::block_on(connection.cancel())
    }

    pub fn disconnect(&self, cwd: &str, id: &str) {
        drop(self.connections.remove(&server_key(cwd, id)));
    }

    pub fn shutdown_all(&self) {
        drop(self.connections.drain());
    }

    pub fn shutdown_idle(&self, idle: Duration) {
        drop(self.connections.evict(|c| c.last_used.lock().elapsed() > idle));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launch(args: &[&str], env: &[(&str, &str)]) -> Launch {
        Launch {
            transport: agent_config::Transport::Stdio,
            command: Some("npx".into()),
            args: args.iter().map(|a| a.to_string()).collect(),
            env: env.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            url: None,
            headers: Vec::new(),
        }
    }

    #[test]
    fn detects_servers_from_urls_and_env() {
        let url = detect(&launch(&["-y", "server", "postgresql://u:p@db.example:6543/app"], &[]), false).unwrap().unwrap();
        assert_eq!((url.host.as_str(), url.port, url.config.get_dbname()), ("db.example", 6543, Some("app")));
        let env = detect(&launch(&[], &[("PG_HOST", "localhost"), ("PG_PORT", "5434"), ("PG_USER", "read_user")]), false).unwrap().unwrap();
        assert_eq!((env.host.as_str(), env.port, env.config.get_user()), ("localhost", 5434, Some("read_user")));
        assert!(detect(&launch(&[], &[("DATABASE_URI", "postgres://h/db")]), false).is_some());
        assert!(detect(&launch(&[], &[("DATABASE_URL", "mysql://h/db")]), false).is_none());
        assert!(detect(&launch(&[], &[("DB_HOST", "h")]), false).is_none());
        assert!(detect(&launch(&[], &[("DB_HOST", "h")]), true).is_some());
        assert!(detect(&launch(&[], &[("PG_HOST", "h"), ("PG_PORT", "x")]), false).unwrap().is_err());
    }

    #[test]
    fn keeps_existing_options_and_maps_verify_modes() {
        let target = parse_connection("postgres://u@h/db?options=-c%20search_path%3Dapp&sslmode=verify-full").unwrap();
        assert_eq!(target.config.get_options(), Some("-c search_path=app -c statement_timeout=60000"));
        assert_eq!(target.verify, Verify::Full);
        assert_eq!(target.config.get_ssl_mode(), tokio_postgres::config::SslMode::Require);
        let target = parse_connection("host=h sslmode=VERIFY-CA application_name=mine").unwrap();
        assert_eq!((target.verify, target.config.get_application_name()), (Verify::Chain, Some("mine")));
        assert_eq!(parse_connection("postgres://h/db").unwrap().config.get_options(), Some("-c statement_timeout=60000"));
    }
}
