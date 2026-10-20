mod relay;
mod target;

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use anyhow::anyhow;
use futures_util::StreamExt;
use parking_lot::Mutex;
use postgres_native_tls::{MakeTlsConnector, TlsConnector};
use serde::Serialize;
use tokio::net::TcpStream;
use tokio_postgres::{tls::MakeTlsConnect, CancelToken, Client, SimpleQueryMessage};

use crate::{
    agent_config::{self, ResolvedServer},
    pool::{server_key, Pool},
};
use relay::{wsl_relay, Relay};
pub(crate) use target::detect;
use target::{target_for, Target, Verify};

const MAX_ROWS: usize = 2000;
const STATEMENT_TIMEOUT: Duration = Duration::from_secs(60);
const QUERY_GRACE: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const IDLE_CHECK_AFTER: Duration = Duration::from_secs(30);
const VALIDATE_TIMEOUT: Duration = Duration::from_secs(5);
const KEEPALIVE_IDLE: Duration = Duration::from_secs(30);
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(10);

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
            let keepalive = socket2::TcpKeepalive::new().with_time(KEEPALIVE_IDLE).with_interval(KEEPALIVE_INTERVAL);
            let _ = socket2::SockRef::from(&stream).set_tcp_keepalive(&keepalive);
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

fn describe(error: tokio_postgres::Error) -> anyhow::Error {
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
