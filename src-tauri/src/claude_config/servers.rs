use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::{Map, Value};

use super::{ctx::same_path, json_file, keys, redact, strings, Scope, Snapshot};
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
    id: String,
    name: String,
    scope: Scope,
    plugin: Option<String>,
    source: PathBuf,
    config: Map<String, Value>,
    plugin_root: Option<String>,
    disabled: bool,
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

fn server_map(value: &Value) -> Option<&Map<String, Value>> {
    value.get("mcpServers").and_then(Value::as_object).or_else(|| {
        value.as_object().filter(|m| m.values().all(|v| v.get("command").is_some() || v.get("url").is_some()))
    })
}

fn claude_json_project<'a>(snapshot: &Snapshot, root: &'a Value, dir: &Path) -> Option<&'a Value> {
    root.get("projects")?.as_object()?.iter().find(|(key, _)| same_path(&snapshot.ctx.host(key), dir)).map(|(_, v)| v)
}

fn short_plugin_name(name: &str) -> String {
    name.split('@').next().unwrap_or(name).to_string()
}

pub fn raw_servers(snapshot: &Snapshot) -> Vec<RawServer> {
    let mut servers = Vec::new();
    let mut push = |scope: Scope, plugin: Option<(String, String)>, source: &Path, map: &Map<String, Value>, disabled: &HashSet<String>| {
        for (name, config) in map {
            let Some(config) = config.as_object() else { continue };
            let (plugin_name, plugin_root) = plugin.clone().unzip();
            let id = match &plugin_name {
                Some(p) => format!("plugin:{p}:{name}"),
                None => format!("{}:{name}", scope.as_str()),
            };
            servers.push(RawServer {
                id,
                name: name.clone(),
                scope,
                plugin: plugin_name,
                source: source.to_path_buf(),
                config: config.clone(),
                plugin_root,
                disabled: disabled.contains(name),
            });
        }
    };

    let none = HashSet::new();
    let claude_json = snapshot.claude_json.value.as_ref().unwrap_or(&Value::Null);
    if let Some(map) = claude_json.get("mcpServers").and_then(Value::as_object) {
        push(Scope::User, None, &snapshot.claude_json_path, map, &none);
    }
    let local = snapshot.dirs.iter().find_map(|d| claude_json_project(snapshot, claude_json, d));
    if let Some(map) = local.and_then(|p| p.get("mcpServers")).and_then(Value::as_object) {
        push(Scope::Local, None, &snapshot.claude_json_path, map, &none);
    }
    let disabled: HashSet<String> = strings(local.and_then(|p| p.get("disabledMcpjsonServers"))).into_iter().collect();
    let project = snapshot.dirs.iter().map(|d| d.join(".mcp.json")).find_map(|p| json_file(&p).value.clone().map(|v| (p, v)));
    if let Some((path, value)) = project {
        if let Some(map) = server_map(&value) {
            push(Scope::Project, None, &path, map, &disabled);
        }
    }
    for plugin in snapshot.plugins.iter().filter(|p| p.enabled) {
        let manifest = plugin.root.join(".mcp.json");
        let from_plugin_json = || {
            let path = plugin.root.join(".claude-plugin").join("plugin.json");
            json_file(&path).value.clone().filter(|v| v.get("mcpServers").is_some_and(Value::is_object)).map(|v| (path, v))
        };
        let found = json_file(&manifest).value.clone().map(|v| (manifest.clone(), v)).or_else(from_plugin_json);
        if let Some((path, value)) = found {
            if let Some(map) = server_map(&value) {
                let root = snapshot.ctx.native(&plugin.root);
                push(Scope::Plugin, Some((short_plugin_name(&plugin.name), root)), &path, map, &none);
            }
        }
    }
    servers
}

fn resolved(snapshot: &Snapshot, raw: &RawServer) -> ResolvedServer {
    ResolvedServer {
        config: raw.config.clone(),
        plugin_root: raw.plugin_root.clone(),
        cwd: snapshot.ctx.native(&snapshot.cwd),
        distro: snapshot.ctx.distro.clone(),
    }
}

pub fn mentions_postgres(name: &str, config: &Map<String, Value>) -> bool {
    let text = |v: Option<&Value>| v.map(|v| v.to_string().to_lowercase()).unwrap_or_default();
    let haystack = format!("{} {} {}", name.to_lowercase(), text(config.get("command")), text(config.get("args")));
    haystack.contains("postgres") || haystack.contains("pgsql")
}

pub fn describe_server(snapshot: &Snapshot, raw: &RawServer) -> McpServer {
    let config = &raw.config;
    let postgres = mentions_postgres(&raw.name, config) || crate::pg::detect(&launch(&resolved(snapshot, raw)), false).is_some();
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

fn find(snapshot: &Snapshot, id: &str) -> anyhow::Result<RawServer> {
    raw_servers(snapshot)
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| anyhow::anyhow!("MCP server {id} is no longer configured"))
}

pub fn resolve_server(cwd: &str, id: &str) -> anyhow::Result<ResolvedServer> {
    let snapshot = Snapshot::load(cwd)?;
    let raw = find(&snapshot, id)?;
    Ok(resolved(&snapshot, &raw))
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
