use std::collections::HashMap;

use anyhow::{anyhow, Context};
use tokio_postgres::{config::Host, Config};

use super::{CONNECT_TIMEOUT, STATEMENT_TIMEOUT};
use crate::agent_config::{self, Launch, ResolvedServer};

const DEFAULT_PORT: u16 = 5432;

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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Verify {
    Nothing,
    Chain,
    Full,
}

pub(crate) struct Target {
    pub(super) config: Config,
    pub(super) host: String,
    pub(super) port: u16,
    pub(super) verify: Verify,
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
        config.application_name("agent-deck");
    }
    let host = config.get_hosts().first().map(|Host::Tcp(host)| host.clone());
    let port = config.get_ports().first().copied().unwrap_or(DEFAULT_PORT);
    Target { host: host.unwrap_or_else(|| "localhost".into()), port, verify, config }
}

fn parse_connection(connection: &str) -> anyhow::Result<Target> {
    let (connection, verify) = strip_verification(connection.trim());
    let config = connection.parse::<Config>().context("The connection string isn't valid")?;
    Ok(finish(config, verify))
}

pub(crate) fn detect(launch: &Launch, hinted: bool) -> Option<anyhow::Result<Target>> {
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

pub(super) fn target_for(server: &ResolvedServer) -> anyhow::Result<Target> {
    detect(&agent_config::launch(server), true).unwrap_or_else(|| Err(anyhow!("Couldn't find database credentials in this server's config")))
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
