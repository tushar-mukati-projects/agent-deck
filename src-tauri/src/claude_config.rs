
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::{sessions::claude_home, util::path_mtime_ms, wsl};

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Scope {
    User,
    Project,
    Local,
    Plugin,
    Auto,
}

impl Scope {
    fn as_str(self) -> &'static str {
        match self {
            Scope::User => "user",
            Scope::Project => "project",
            Scope::Local => "local",
            Scope::Plugin => "plugin",
            Scope::Auto => "auto",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryFile {
    pub scope: Scope,
    pub label: String,
    pub path: String,
    pub exists: bool,
    pub description: Option<String>,
    pub size: u64,
    pub modified_ms: u64,
}

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub name: String,
    pub description: Option<String>,
    pub path: String,
    pub scope: Scope,
    pub plugin: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hook {
    pub event: String,
    pub matcher: Option<String>,
    pub command: String,
    pub scope: Scope,
    pub plugin: Option<String>,
    pub source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFile {
    pub scope: Scope,
    pub label: String,
    pub path: String,
    pub exists: bool,
    pub model: Option<String>,
    pub default_mode: Option<String>,
    pub allow: Vec<String>,
    pub deny: Vec<String>,
    pub ask: Vec<String>,
    pub env_keys: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    pub name: String,
    pub version: Option<String>,
    pub scope: String,
    pub enabled: bool,
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overview {
    pub claude_home: String,
    pub distro: Option<String>,
    pub memory: Vec<MemoryFile>,
    pub mcp: Vec<McpServer>,
    pub skills: Vec<Item>,
    pub agents: Vec<Item>,
    pub commands: Vec<Item>,
    pub hooks: Vec<Hook>,
    pub settings: Vec<SettingsFile>,
    pub plugins: Vec<Plugin>,
}

pub struct ResolvedServer {
    pub config: Map<String, Value>,
    pub plugin_root: Option<String>,
    pub distro: Option<String>,
    pub cwd: String,
}

pub struct Ctx {
    pub distro: Option<String>,
    pub home: PathBuf,
    pub claude_home: PathBuf,
}

impl Ctx {
    pub fn for_cwd(cwd: &Path) -> anyhow::Result<Self> {
        let Some((distro, linux)) = wsl::parse_host_path(&cwd.to_string_lossy()) else {
            return Ok(Self { distro: None, home: home(), claude_home: claude_home() });
        };
        anyhow::ensure!(wsl::is_running(&distro), "WSL {distro} is stopped");
        let home = PathBuf::from(wsl::host_path(&distro, &wsl::home_for(&distro, &linux)?));
        Ok(Self { claude_home: home.join(".claude"), home, distro: Some(distro) })
    }

    fn host(&self, path: &str) -> PathBuf {
        match &self.distro {
            Some(distro) if path.starts_with('/') => PathBuf::from(wsl::host_path(distro, path)),
            _ => PathBuf::from(path),
        }
    }

    fn native(&self, path: &Path) -> String {
        let text = path.to_string_lossy().to_string();
        if self.distro.is_none() {
            return text;
        }
        wsl::parse_host_path(&text).map(|(_, linux)| linux).unwrap_or(text)
    }
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

fn string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

fn keys(value: Option<&Value>) -> Vec<String> {
    value.and_then(Value::as_object).map(|m| m.keys().cloned().collect()).unwrap_or_default()
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_default()
}

fn same_path(a: &Path, b: &Path) -> bool {
    let norm = |p: &Path| p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase();
    norm(a) == norm(b)
}

fn project_dirs(ctx: &Ctx, cwd: &Path) -> Vec<PathBuf> {
    let home = &ctx.home;
    let mut dirs = Vec::new();
    let mut current = Some(cwd);
    while let Some(dir) = current {
        if same_path(dir, home) {
            break;
        }
        dirs.push(dir.to_path_buf());
        current = dir.parent();
    }
    dirs
}

fn unquote(value: &str) -> String {
    let quoted = |q: char| value.len() >= 2 && value.starts_with(q) && value.ends_with(q);
    if quoted('"') {
        value[1..value.len() - 1].replace("\\\"", "\"").replace("\\\\", "\\")
    } else if quoted('\'') {
        value[1..value.len() - 1].replace("''", "'")
    } else {
        value.to_string()
    }
}

pub fn frontmatter(text: &str) -> HashMap<String, String> {
    let mut fields = HashMap::new();
    let text = text.trim_start_matches('\u{feff}');
    let Some(rest) = text.strip_prefix("---") else { return fields };
    let Some(end) = rest.find("\n---") else { return fields };
    let mut last: Option<String> = None;
    for line in rest[..end].lines() {
        let indented = line.starts_with(' ') || line.starts_with('\t');
        match line.split_once(':') {
            Some((key, value)) if !indented && !key.trim().is_empty() && !key.contains(' ') => {
                let value = unquote(value.trim());
                let key = key.trim().to_string();
                fields.insert(key.clone(), value);
                last = Some(key);
            }
            _ => {
                if let (Some(key), true) = (&last, indented) {
                    if let Some(existing) = fields.get_mut(key) {
                        let piece = line.trim().trim_start_matches("- ");
                        if !piece.is_empty() && existing.len() < 600 {
                            if !existing.is_empty() {
                                existing.push(' ');
                            }
                            existing.push_str(piece);
                        }
                    }
                }
            }
        }
    }
    fields
}

fn describe(path: &Path) -> (Option<String>, Option<String>) {
    let text = fs::read_to_string(path).unwrap_or_default();
    let fields = frontmatter(&text);
    let description = fields.get("description").filter(|d| !d.is_empty()).cloned().map(|d| {
        if d.chars().count() > 400 {
            d.chars().take(400).collect::<String>() + "…"
        } else {
            d
        }
    });
    (fields.get("name").filter(|n| !n.is_empty()).cloned(), description)
}

fn memory_file(scope: Scope, label: String, path: PathBuf) -> MemoryFile {
    let meta = fs::metadata(&path).ok();
    let description = meta.as_ref().filter(|m| m.is_file()).and_then(|_| describe(&path).1);
    MemoryFile {
        scope,
        label,
        exists: meta.as_ref().is_some_and(|m| m.is_file()),
        size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
        modified_ms: path_mtime_ms(&path),
        description,
        path: path.to_string_lossy().to_string(),
    }
}

pub fn project_key(path: &str) -> String {
    path.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

fn memory(ctx: &Ctx, cwd: &Path) -> Vec<MemoryFile> {
    let mut files = vec![memory_file(Scope::User, "CLAUDE.md · all folders".into(), ctx.claude_home.join("CLAUDE.md"))];
    let codex_agents = ctx.home.join(".codex").join("AGENTS.md");
    if codex_agents.is_file() {
        files.push(memory_file(Scope::User, "AGENTS.md · Codex, all folders".into(), codex_agents));
    }
    for (index, dir) in project_dirs(ctx, cwd).iter().enumerate() {
        let folder = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| dir.to_string_lossy().to_string());
        for (name, scope) in [
            ("CLAUDE.md", Scope::Project),
            (".claude/CLAUDE.md", Scope::Project),
            ("CLAUDE.local.md", Scope::Local),
            ("AGENTS.md", Scope::Project),
        ] {
            let path = dir.join(name);
            if path.is_file() || (index == 0 && name == "CLAUDE.md") {
                files.push(memory_file(scope, format!("{name} · {folder}"), path));
            }
        }
    }
    let projects = ctx.claude_home.join("projects");
    let auto = std::iter::once(cwd.to_path_buf())
        .chain(project_dirs(ctx, cwd).into_iter().skip(1))
        .map(|dir| projects.join(project_key(&ctx.native(&dir))).join("memory"))
        .find(|dir| dir.is_dir());
    if let Some(dir) = auto {
        let mut entries: Vec<PathBuf> = fs::read_dir(&dir)
            .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "md")).collect())
            .unwrap_or_default();
        entries.sort_by_key(|p| (p.file_name().is_none_or(|n| n != "MEMORY.md"), p.clone()));
        for path in entries {
            let label = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            files.push(memory_file(Scope::Auto, label, path));
        }
    }
    files
}

struct InstalledPlugin {
    name: String,
    version: Option<String>,
    scope: String,
    root: PathBuf,
    enabled: bool,
}

fn enabled_plugins(ctx: &Ctx, cwd: &Path) -> HashMap<String, bool> {
    let mut enabled = HashMap::new();
    let mut files = vec![ctx.claude_home.join("settings.json")];
    for dir in project_dirs(ctx, cwd).iter().rev() {
        files.push(dir.join(".claude").join("settings.json"));
        files.push(dir.join(".claude").join("settings.local.json"));
    }
    for file in files {
        if let Some(map) = read_json(&file).and_then(|v| v.get("enabledPlugins").cloned()).and_then(|v| v.as_object().cloned()) {
            for (name, value) in map {
                enabled.insert(name, value.as_bool().unwrap_or(true));
            }
        }
    }
    enabled
}

fn installed_plugins(ctx: &Ctx, cwd: &Path) -> Vec<InstalledPlugin> {
    let Some(data) = read_json(&ctx.claude_home.join("plugins").join("installed_plugins.json")) else { return Vec::new() };
    let enabled = enabled_plugins(ctx, cwd);
    let project_dirs = project_dirs(ctx, cwd);
    let mut plugins = Vec::new();
    for (name, entries) in data.get("plugins").and_then(Value::as_object).into_iter().flatten() {
        for entry in entries.as_array().into_iter().flatten() {
            let scope = string(entry, "scope").unwrap_or_else(|| "user".into());
            let applies = scope == "user"
                || string(entry, "projectPath").is_some_and(|p| project_dirs.iter().any(|d| same_path(d, &ctx.host(&p))));
            let Some(root) = string(entry, "installPath").map(|p| ctx.host(&p)) else { continue };
            if !applies || !root.is_dir() {
                continue;
            }
            plugins.push(InstalledPlugin {
                name: name.clone(),
                version: string(entry, "version"),
                enabled: enabled.get(name).copied().unwrap_or(scope != "user"),
                scope,
                root,
            });
            break;
        }
    }
    plugins.sort_by(|a, b| a.name.cmp(&b.name));
    plugins
}

fn short_plugin_name(name: &str) -> String {
    name.split('@').next().unwrap_or(name).to_string()
}

fn looks_secret(arg: &str) -> bool {
    let token_like = arg.len() >= 24 && arg.chars().all(|c| c.is_ascii_alphanumeric() || "-_.=+/".contains(c)) && arg.chars().any(|c| c.is_ascii_digit());
    token_like || arg.contains("://") && arg.contains('@')
}

fn mask_args(args: &[String]) -> Vec<String> {
    let mut masked = Vec::with_capacity(args.len());
    let mut hide_next = false;
    for arg in args {
        let lower = arg.to_lowercase();
        if hide_next || looks_secret(arg) {
            masked.push("••••••".into());
        } else if let Some((flag, _)) = arg.split_once('=').filter(|(f, _)| is_secret_flag(f)) {
            masked.push(format!("{flag}=••••••"));
        } else {
            masked.push(arg.clone());
        }
        hide_next = is_secret_flag(&lower) && !arg.contains('=');
    }
    masked
}

fn is_secret_flag(flag: &str) -> bool {
    let flag = flag.to_lowercase();
    flag.starts_with('-') && ["token", "key", "secret", "password", "passwd", "auth"].iter().any(|w| flag.contains(w))
}

fn server_map(value: &Value) -> Option<&Map<String, Value>> {
    value.get("mcpServers").and_then(Value::as_object).or_else(|| {
        value.as_object().filter(|m| m.values().all(|v| v.get("command").is_some() || v.get("url").is_some()))
    })
}

struct RawServer {
    id: String,
    name: String,
    scope: Scope,
    plugin: Option<String>,
    source: PathBuf,
    config: Map<String, Value>,
    plugin_root: Option<String>,
    disabled: bool,
}

fn claude_json_project<'a>(ctx: &Ctx, root: &'a Value, dir: &Path) -> Option<&'a Value> {
    root.get("projects")?.as_object()?.iter().find(|(key, _)| same_path(&ctx.host(key), dir)).map(|(_, v)| v)
}

fn raw_servers(ctx: &Ctx, cwd: &Path) -> Vec<RawServer> {
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

    let claude_json_path = ctx.home.join(".claude.json");
    let claude_json = read_json(&claude_json_path).unwrap_or(Value::Null);
    let none = HashSet::new();
    if let Some(map) = claude_json.get("mcpServers").and_then(Value::as_object) {
        push(Scope::User, None, &claude_json_path, map, &none);
    }
    let dirs = project_dirs(ctx, cwd);
    let local = dirs.iter().find_map(|d| claude_json_project(ctx, &claude_json, d));
    if let Some(map) = local.and_then(|p| p.get("mcpServers")).and_then(Value::as_object) {
        push(Scope::Local, None, &claude_json_path, map, &none);
    }
    let disabled: HashSet<String> = strings(local.and_then(|p| p.get("disabledMcpjsonServers"))).into_iter().collect();
    if let Some((path, value)) = dirs.iter().map(|d| d.join(".mcp.json")).find_map(|p| read_json(&p).map(|v| (p, v))) {
        if let Some(map) = server_map(&value) {
            push(Scope::Project, None, &path, map, &disabled);
        }
    }
    for plugin in installed_plugins(ctx, cwd).into_iter().filter(|p| p.enabled) {
        let manifest = plugin.root.join(".mcp.json");
        let from_manifest = read_json(&manifest).map(|v| (manifest.clone(), v));
        let from_plugin_json = || {
            let path = plugin.root.join(".claude-plugin").join("plugin.json");
            read_json(&path).filter(|v| v.get("mcpServers").is_some_and(Value::is_object)).map(|v| (path, v))
        };
        if let Some((path, value)) = from_manifest.or_else(from_plugin_json) {
            if let Some(map) = server_map(&value) {
                push(Scope::Plugin, Some((short_plugin_name(&plugin.name), ctx.native(&plugin.root))), &path, map, &none);
            }
        }
    }
    servers
}

fn env_map(config: &Map<String, Value>) -> HashMap<String, String> {
    config
        .get("env")
        .and_then(Value::as_object)
        .map(|m| m.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect())
        .unwrap_or_default()
}

pub const PG_ENV_KEYS: [&str; 6] = ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_CONNECTION_STRING", "PG_CONNECTION_STRING", "PG_HOST", "PGHOST"];

fn is_postgres(name: &str, config: &Map<String, Value>) -> bool {
    let text = |v: Option<&Value>| v.map(|v| v.to_string().to_lowercase()).unwrap_or_default();
    let haystack = format!("{} {} {}", name.to_lowercase(), text(config.get("command")), text(config.get("args")));
    let env = env_map(config);
    haystack.contains("postgres")
        || haystack.contains("postgresql://")
        || PG_ENV_KEYS.iter().any(|k| env.get(*k).is_some_and(|v| !v.is_empty() && (!k.contains("URL") || v.starts_with("postgres"))))
}

fn describe_server(raw: &RawServer) -> McpServer {
    let config = &raw.config;
    let transport = config
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| if config.contains_key("url") { "http".into() } else { "stdio".into() });
    McpServer {
        id: raw.id.clone(),
        name: raw.name.clone(),
        scope: raw.scope,
        plugin: raw.plugin.clone(),
        source: raw.source.to_string_lossy().to_string(),
        transport,
        command: config.get("command").and_then(Value::as_str).map(str::to_string),
        args: mask_args(&strings(config.get("args"))),
        url: config.get("url").and_then(Value::as_str).map(|u| mask_args(&[u.to_string()]).remove(0)),
        env_keys: keys(config.get("env")),
        header_keys: keys(config.get("headers")),
        postgres: is_postgres(&raw.name, config),
        disabled: raw.disabled,
    }
}

pub fn resolve_server(cwd: &Path, id: &str) -> anyhow::Result<ResolvedServer> {
    let ctx = Ctx::for_cwd(cwd)?;
    let raw = raw_servers(&ctx, cwd)
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| anyhow::anyhow!("MCP server {id} is no longer configured"))?;
    Ok(ResolvedServer { config: raw.config, plugin_root: raw.plugin_root, cwd: ctx.native(cwd), distro: ctx.distro })
}

fn skill_dirs(root: &Path, scope: Scope, plugin: Option<&str>, out: &mut Vec<Item>) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let skill = entry.path().join("SKILL.md");
        if !skill.is_file() {
            continue;
        }
        let (name, description) = describe(&skill);
        out.push(Item {
            name: name.unwrap_or_else(|| entry.file_name().to_string_lossy().to_string()),
            description,
            path: skill.to_string_lossy().to_string(),
            scope,
            plugin: plugin.map(str::to_string),
        });
    }
}

fn markdown_items(root: &Path, prefix: &str, scope: Scope, plugin: Option<&str>, recursive: bool, out: &mut Vec<Item>) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        if path.is_dir() && recursive {
            markdown_items(&path, &format!("{prefix}{stem}:"), scope, plugin, true, out);
        } else if path.extension().is_some_and(|x| x == "md") {
            let (name, description) = describe(&path);
            out.push(Item {
                name: if prefix.is_empty() { name.unwrap_or(stem) } else { format!("{prefix}{stem}") },
                description,
                path: path.to_string_lossy().to_string(),
                scope,
                plugin: plugin.map(str::to_string),
            });
        }
    }
}

fn settings_file(scope: Scope, label: &str, path: PathBuf) -> SettingsFile {
    let value = read_json(&path);
    let perms = value.as_ref().and_then(|v| v.get("permissions"));
    SettingsFile {
        scope,
        label: label.to_string(),
        exists: value.is_some(),
        model: value.as_ref().and_then(|v| string(v, "model")),
        default_mode: perms.and_then(|p| string(p, "defaultMode")),
        allow: strings(perms.and_then(|p| p.get("allow"))),
        deny: strings(perms.and_then(|p| p.get("deny"))),
        ask: strings(perms.and_then(|p| p.get("ask"))),
        env_keys: keys(value.as_ref().and_then(|v| v.get("env"))),
        path: path.to_string_lossy().to_string(),
    }
}

fn hooks_from(value: &Value, scope: Scope, plugin: Option<&str>, source: &Path, out: &mut Vec<Hook>) {
    for (event, groups) in value.get("hooks").and_then(Value::as_object).into_iter().flatten() {
        for group in groups.as_array().into_iter().flatten() {
            let matcher = string(group, "matcher").filter(|m| !m.is_empty());
            for hook in group.get("hooks").and_then(Value::as_array).into_iter().flatten() {
                let command = string(hook, "command").or_else(|| string(hook, "prompt")).or_else(|| string(hook, "url")).unwrap_or_default();
                out.push(Hook {
                    event: event.clone(),
                    matcher: matcher.clone(),
                    command,
                    scope,
                    plugin: plugin.map(str::to_string),
                    source: source.to_string_lossy().to_string(),
                });
            }
        }
    }
}

pub fn overview(cwd: &str) -> anyhow::Result<Overview> {
    let cwd = Path::new(cwd);
    let ctx = Ctx::for_cwd(cwd)?;
    let home = ctx.claude_home.clone();
    let dirs = project_dirs(&ctx, cwd);
    let plugins = installed_plugins(&ctx, cwd);

    let mut skills = Vec::new();
    let mut agents = Vec::new();
    let mut commands = Vec::new();
    skill_dirs(&home.join("skills"), Scope::User, None, &mut skills);
    markdown_items(&home.join("agents"), "", Scope::User, None, false, &mut agents);
    markdown_items(&home.join("commands"), "", Scope::User, None, true, &mut commands);
    for dir in &dirs {
        let claude = dir.join(".claude");
        skill_dirs(&claude.join("skills"), Scope::Project, None, &mut skills);
        markdown_items(&claude.join("agents"), "", Scope::Project, None, false, &mut agents);
        markdown_items(&claude.join("commands"), "", Scope::Project, None, true, &mut commands);
    }

    let mut settings = vec![
        settings_file(Scope::User, "User settings", home.join("settings.json")),
        settings_file(Scope::User, "User local settings", home.join("settings.local.json")),
    ];
    for dir in &dirs {
        let claude = dir.join(".claude");
        let folder = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        settings.push(settings_file(Scope::Project, &format!("Project settings · {folder}"), claude.join("settings.json")));
        settings.push(settings_file(Scope::Local, &format!("Local settings · {folder}"), claude.join("settings.local.json")));
    }
    let mut hooks = Vec::new();
    for file in &settings {
        if let Some(value) = read_json(Path::new(&file.path)) {
            hooks_from(&value, file.scope, None, Path::new(&file.path), &mut hooks);
        }
    }
    settings.retain(|s| s.exists || s.scope == Scope::User);

    for plugin in plugins.iter().filter(|p| p.enabled) {
        let short = short_plugin_name(&plugin.name);
        skill_dirs(&plugin.root.join("skills"), Scope::Plugin, Some(&short), &mut skills);
        markdown_items(&plugin.root.join("agents"), "", Scope::Plugin, Some(&short), false, &mut agents);
        markdown_items(&plugin.root.join("commands"), &format!("{short}:"), Scope::Plugin, Some(&short), true, &mut commands);
        let hooks_file = plugin.root.join("hooks").join("hooks.json");
        if let Some(value) = read_json(&hooks_file) {
            hooks_from(&value, Scope::Plugin, Some(&short), &hooks_file, &mut hooks);
        }
    }
    for list in [&mut skills, &mut agents, &mut commands] {
        list.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    }

    Ok(Overview {
        claude_home: home.to_string_lossy().to_string(),
        distro: ctx.distro.clone(),
        memory: memory(&ctx, cwd),
        mcp: raw_servers(&ctx, cwd).iter().map(describe_server).collect(),
        skills,
        agents,
        commands,
        hooks,
        settings,
        plugins: plugins
            .into_iter()
            .map(|p| Plugin {
                name: p.name,
                version: p.version,
                scope: p.scope,
                enabled: p.enabled,
                path: p.root.to_string_lossy().to_string(),
            })
            .collect(),
    })
}

pub fn expand(value: &str, env: &HashMap<String, String>, plugin_root: Option<&str>) -> String {
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
        let resolved = match name {
            "CLAUDE_PLUGIN_ROOT" => plugin_root.map(str::to_string),
            _ => env.get(name).cloned().or_else(|| std::env::var(name).ok()),
        };
        out.push_str(&resolved.or(default.map(str::to_string)).unwrap_or_default());
        rest = &rest[start + end + 1..];
    }
    out.push_str(rest);
    out
}

pub fn server_env(server: &ResolvedServer) -> HashMap<String, String> {
    let raw = env_map(&server.config);
    let root = server.plugin_root.as_deref();
    raw.iter().map(|(k, v)| (k.clone(), expand(v, &raw, root))).collect()
}

pub fn create_memory_file(path: &str) -> anyhow::Result<()> {
    let path = Path::new(path);
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    anyhow::ensure!(name == "CLAUDE.md" || name == "CLAUDE.local.md", "Only CLAUDE.md files can be created here");
    anyhow::ensure!(path.parent().is_some_and(Path::is_dir), "The folder doesn't exist");
    use std::io::Write;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(b"# Notes for Claude\n\n")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_handles_multiline_values() {
        assert_eq!(frontmatter("---\ndescription: \"a \\\"b\\\" c\"\n---")["description"], "a \"b\" c");
        let fields = frontmatter("---\nname: x\ndescription: first\n  second\nreferences:\n  - a\n---\nbody");
        assert_eq!(fields["name"], "x");
        assert_eq!(fields["description"], "first second");
        assert_eq!(fields["references"], "a");
    }

    #[test]
    fn masks_secret_looking_args() {
        let masked = mask_args(&[
            "-y".into(),
            "mcp-server".into(),
            "--api-key".into(),
            "abc".into(),
            "--token=xyz".into(),
            "postgres://u:pw@host/db".into(),
        ]);
        assert_eq!(masked, ["-y", "mcp-server", "--api-key", "••••••", "--token=••••••", "••••••"]);
    }

    #[test]
    fn expands_variables() {
        let env = HashMap::from([("A".to_string(), "1".to_string())]);
        assert_eq!(expand("x${A}y${MISSING:-d}", &env, None), "x1yd");
        assert_eq!(expand("${CLAUDE_PLUGIN_ROOT}/s", &env, Some("/p")), "/p/s");
    }

    #[test]
    fn project_key_matches_claude_code() {
        assert_eq!(project_key(r"C:\Users\me\my-files"), "C--Users-me-my-files");
        assert_eq!(project_key("/home/me/work/app"), "-home-me-work-app");
    }
}
