
use std::{collections::HashMap, path::Path, sync::Arc, time::{Duration, Instant}};

use anyhow::{anyhow, Context};
use parking_lot::Mutex;
use postgres::{Client, Config, SimpleQueryMessage};
use postgres_native_tls::MakeTlsConnector;
use serde::Serialize;
use serde_json::Value;

use crate::claude_config::{self, ResolvedServer};

const MAX_ROWS: usize = 2000;
const STATEMENT_TIMEOUT_MS: u64 = 60_000;

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

#[derive(Default)]
pub struct PgManager {
    clients: Mutex<HashMap<String, Arc<Mutex<Client>>>>,
}

fn first<'a>(env: &'a HashMap<String, String>, names: &[&str]) -> Option<&'a String> {
    names.iter().find_map(|n| env.get(*n).filter(|v| !v.is_empty()))
}

fn config_for(server: &ResolvedServer) -> anyhow::Result<Config> {
    let env = claude_config::server_env(server);
    let root = server.plugin_root.as_deref();
    let args: Vec<String> = server
        .config
        .get("args")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(|s| claude_config::expand(s, &env, root)).collect())
        .unwrap_or_default();
    let url = args
        .iter()
        .find(|a| a.starts_with("postgres://") || a.starts_with("postgresql://"))
        .or_else(|| first(&env, &["DATABASE_URL", "POSTGRES_URL", "POSTGRES_CONNECTION_STRING", "PG_CONNECTION_STRING", "DB_URL"]))
        .filter(|u| u.starts_with("postgres"));
    let mut config = match url {
        Some(url) => url.parse::<Config>().context("The connection string isn't valid")?,
        None => {
            let host = first(&env, &["PG_HOST", "PGHOST", "POSTGRES_HOST", "DB_HOST"])
                .ok_or_else(|| anyhow!("Couldn't find database credentials in this server's config"))?;
            let mut config = Config::new();
            config.host(host);
            if let Some(port) = first(&env, &["PG_PORT", "PGPORT", "POSTGRES_PORT", "DB_PORT"]).and_then(|p| p.parse().ok()) {
                config.port(port);
            }
            if let Some(user) = first(&env, &["PG_USER", "PGUSER", "POSTGRES_USER", "DB_USER"]) {
                config.user(user);
            }
            if let Some(password) = first(&env, &["PG_PASSWORD", "PGPASSWORD", "POSTGRES_PASSWORD", "DB_PASSWORD"]) {
                config.password(password);
            }
            if let Some(db) = first(&env, &["PG_DATABASE", "PGDATABASE", "POSTGRES_DB", "POSTGRES_DATABASE", "DB_NAME"]) {
                config.dbname(db);
            }
            config
        }
    };
    config
        .connect_timeout(Duration::from_secs(10))
        .application_name("claude-deck")
        .options(&format!("-c statement_timeout={STATEMENT_TIMEOUT_MS}"));
    Ok(config)
}

fn connect(config: &Config) -> anyhow::Result<Client> {
    let lenient = matches!(config.get_ssl_mode(), postgres::config::SslMode::Require);
    let tls = native_tls::TlsConnector::builder().danger_accept_invalid_certs(lenient).build()?;
    config.connect(MakeTlsConnector::new(tls)).map_err(|error| {
        if error.as_db_error().is_some() {
            return describe(error);
        }
        let host = match config.get_hosts().first() {
            Some(postgres::config::Host::Tcp(h)) => h.clone(),
            _ => "the database".into(),
        };
        let port = config.get_ports().first().copied().unwrap_or(5432);
        anyhow!("Couldn't connect to {host}:{port}. Is the database (or the tunnel / port-forward to it) running?\n\n{}", describe(error))
    })
}

fn describe(error: postgres::Error) -> anyhow::Error {
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

fn collect(messages: Vec<SimpleQueryMessage>) -> Vec<QueryResult> {
    let mut results = Vec::new();
    let mut current = QueryResult::default();
    let mut started = false;
    for message in messages {
        match message {
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
    results
}

impl PgManager {
    fn client(&self, cwd: &str, id: &str) -> anyhow::Result<Arc<Mutex<Client>>> {
        let key = format!("{}|{id}", cwd.to_lowercase());
        if let Some(client) = self.clients.lock().get(&key).filter(|c| !c.lock().is_closed()).cloned() {
            return Ok(client);
        }
        let server = claude_config::resolve_server(Path::new(cwd), id)?;
        let client = Arc::new(Mutex::new(connect(&config_for(&server)?)?));
        self.clients.lock().insert(key, client.clone());
        Ok(client)
    }

    pub fn info(&self, cwd: &str, id: &str) -> anyhow::Result<ConnectionInfo> {
        let server = claude_config::resolve_server(Path::new(cwd), id)?;
        let config = config_for(&server)?;
        let host = match config.get_hosts().first() {
            Some(postgres::config::Host::Tcp(h)) => h.clone(),
            #[allow(unreachable_patterns)]
            Some(_) => "socket".into(),
            None => "localhost".into(),
        };
        Ok(ConnectionInfo {
            host,
            port: config.get_ports().first().copied().unwrap_or(5432),
            database: config.get_dbname().unwrap_or_default().to_string(),
            user: config.get_user().unwrap_or_default().to_string(),
        })
    }

    pub fn query(&self, cwd: &str, id: &str, sql: &str) -> anyhow::Result<QueryOutput> {
        let started = Instant::now();
        let client = self.client(cwd, id)?;
        let messages = client.lock().simple_query(sql).map_err(describe)?;
        Ok(QueryOutput { results: collect(messages), elapsed_ms: started.elapsed().as_millis() as u64 })
    }

    pub fn disconnect(&self, cwd: &str, id: &str) {
        self.clients.lock().remove(&format!("{}|{id}", cwd.to_lowercase()));
    }
}
