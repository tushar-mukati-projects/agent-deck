use std::{collections::HashMap, path::PathBuf};

use serde::Serialize;
use serde_json::{Map, Value};

use super::{files::keys, files::strings, redact, Scope};
use crate::wsl;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub scope: Scope,
    pub plugin: Option<String>,
    pub source: String,
    pub transport: String,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub url: Option<String>,
    pub env_keys: Vec<String>,
    pub header_keys: Vec<String>,
    pub postgres: bool,
    pub disabled: bool,
}

pub struct ResolvedServer {
    pub config: Map<String, Value>,
    pub plugin_root: Option<String>,
    pub distro: Option<String>,
    pub cwd: String,
}

pub struct RawServer {
    pub id: String,
    pub name: String,
    pub scope: Scope,
    pub plugin: Option<String>,
    pub source: PathBuf,
    pub config: Map<String, Value>,
    pub plugin_root: Option<String>,
    pub disabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Transport {
    Stdio,
    Http,
    Sse,
    Unknown(String),
}

pub struct Launch {
    pub transport: Transport,
    pub command: Option<String>,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub url: Option<String>,
    pub headers: Vec<(String, String)>,
}

fn transport_name(config: &Map<String, Value>) -> String {
    config
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| if config.contains_key("url") { "http".into() } else { "stdio".into() })
}

fn transport_of(config: &Map<String, Value>) -> Transport {
    match transport_name(config).as_str() {
        "stdio" => Transport::Stdio,
        "http" | "streamable-http" => Transport::Http,
        "sse" => Transport::Sse,
        other => Transport::Unknown(other.to_string()),
    }
}

pub fn expand(value: &str, lookup: &dyn Fn(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let Some(end) = rest[start..].find('}') else {
            out.push_str(&rest[start..]);
            return out;
        };
        let expr = &rest[start + 2..start + end];
        let (name, default) = expr.split_once(":-").map_or((expr, None), |(n, d)| (n, Some(d)));
        out.push_str(&lookup(name).or(default.map(str::to_string)).unwrap_or_default());
        rest = &rest[start + end + 1..];
    }
    out.push_str(rest);
    out
}

fn env_map(config: &Map<String, Value>) -> HashMap<String, String> {
    config
        .get("env")
        .and_then(Value::as_object)
        .map(|m| m.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect())
        .unwrap_or_default()
}

pub fn launch(server: &ResolvedServer) -> Launch {
    let config = &server.config;
    let outer = |name: &str| match &server.distro {
        Some(distro) => wsl::login_var(distro, name),
        None => std::env::var(name).ok(),
    };
    let special = |name: &str| (name == "CLAUDE_PLUGIN_ROOT").then(|| server.plugin_root.clone()).flatten();
    let raw = env_map(config);
    let raw_lookup = |name: &str| special(name).or_else(|| raw.get(name).cloned()).or_else(|| outer(name));
    let env: HashMap<String, String> = raw.iter().map(|(k, v)| (k.clone(), expand(v, &raw_lookup))).collect();
    let lookup = |name: &str| special(name).or_else(|| env.get(name).cloned()).or_else(|| outer(name));
    let text = |key: &str| config.get(key).and_then(Value::as_str).map(|s| expand(s, &lookup));
    let headers = config
        .get("headers")
        .and_then(Value::as_object)
        .map(|m| m.iter().filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), expand(v, &lookup)))).collect())
        .unwrap_or_default();
    Launch {
        transport: transport_of(config),
        command: text("command"),
        args: strings(config.get("args")).iter().map(|a| expand(a, &lookup)).collect(),
        url: text("url"),
        headers,
        env,
    }
}

fn resolved(raw: &RawServer, cwd: String, distro: Option<String>) -> ResolvedServer {
    ResolvedServer { config: raw.config.clone(), plugin_root: raw.plugin_root.clone(), cwd, distro }
}

pub fn mentions_postgres(name: &str, config: &Map<String, Value>) -> bool {
    let text = |v: Option<&Value>| v.map(|v| v.to_string().to_lowercase()).unwrap_or_default();
    let haystack = format!("{} {} {}", name.to_lowercase(), text(config.get("command")), text(config.get("args")));
    haystack.contains("postgres") || haystack.contains("pgsql")
}

fn describe_server(raw: &RawServer, server: &ResolvedServer) -> McpServer {
    let config = &raw.config;
    let postgres = mentions_postgres(&raw.name, config) || crate::pg::detect(&launch(server), false).is_some();
    McpServer {
        id: raw.id.clone(),
        name: raw.name.clone(),
        scope: raw.scope,
        plugin: raw.plugin.clone(),
        source: raw.source.to_string_lossy().to_string(),
        transport: transport_name(config),
        command: config.get("command").and_then(Value::as_str).map(redact::mask_text),
        args: redact::mask_args(&strings(config.get("args"))),
        url: config.get("url").and_then(Value::as_str).map(redact::mask_url),
        env_keys: keys(config.get("env")),
        header_keys: keys(config.get("headers")),
        postgres,
        disabled: raw.disabled,
    }
}

pub fn describe_all(servers: &[RawServer], cwd: &str, distro: Option<&str>) -> Vec<McpServer> {
    servers.iter().map(|raw| describe_server(raw, &resolved(raw, cwd.to_string(), distro.map(str::to_string)))).collect()
}

pub fn resolve(servers: Vec<RawServer>, id: &str, cwd: String, distro: Option<String>) -> anyhow::Result<ResolvedServer> {
    let raw = servers.into_iter().find(|s| s.id == id).ok_or_else(|| anyhow::anyhow!("MCP server {id} is no longer configured"))?;
    Ok(resolved(&raw, cwd, distro))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_variables() {
        let lookup = |name: &str| (name == "A").then(|| "1".to_string());
        assert_eq!(expand("x${A}y${MISSING:-d}z${NONE}", &lookup), "x1ydz");
        assert_eq!(expand("open ${A", &lookup), "open ${A");
    }

    #[test]
    fn launch_expands_env_args_and_plugin_root() {
        let config: Map<String, Value> = serde_json::from_value(serde_json::json!({
            "command": "${CLAUDE_PLUGIN_ROOT}/bin/server",
            "args": ["--db", "${DB}", "${UNSET:-fallback}"],
            "env": { "DB": "postgres://u@h/${NAME:-app}", "TOKEN": "t" },
            "headers": { "Authorization": "Bearer ${TOKEN}" }
        }))
        .unwrap();
        let server = ResolvedServer { config, plugin_root: Some("/p".into()), distro: None, cwd: "/w".into() };
        let launch = launch(&server);
        assert_eq!(launch.transport, Transport::Stdio);
        assert_eq!(launch.command.as_deref(), Some("/p/bin/server"));
        assert_eq!(launch.args, ["--db", "postgres://u@h/app", "fallback"]);
        assert_eq!(launch.headers, [("Authorization".to_string(), "Bearer t".to_string())]);
    }
}
