use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
};

use serde_json::{Map, Value};

use super::{
    ctx::{self, project_dirs, project_key, Ctx},
    files::{auto_memory, folder_name, json_file, markdown_items, memory_file, skill_dirs, sort_by_name, string, strings, Items, JsonFile},
    redact,
    servers::{self, describe_all, RawServer, ResolvedServer},
    Hook, Item, MemoryFile, Overview, Plugin, Scope, SettingsFile,
};

pub struct SettingsEntry {
    pub scope: Scope,
    pub label: String,
    pub path: PathBuf,
    pub file: Arc<JsonFile>,
}

pub struct InstalledPlugin {
    pub name: String,
    pub version: Option<String>,
    pub scope: String,
    pub root: PathBuf,
    pub enabled: bool,
}

pub struct Snapshot {
    pub ctx: Ctx,
    pub cwd: PathBuf,
    pub dirs: Vec<PathBuf>,
    pub claude_json_path: PathBuf,
    pub claude_json: Arc<JsonFile>,
    pub settings: Vec<SettingsEntry>,
    pub plugins: Vec<InstalledPlugin>,
}

fn settings_entries(ctx: &Ctx, dirs: &[PathBuf]) -> Vec<SettingsEntry> {
    let entry = |scope, label: String, path: PathBuf| SettingsEntry { scope, label, file: json_file(&path), path };
    let mut entries = vec![
        entry(Scope::User, "User settings".into(), ctx.claude_home.join("settings.json")),
        entry(Scope::User, "User local settings".into(), ctx.claude_home.join("settings.local.json")),
    ];
    for dir in dirs {
        let claude = dir.join(".claude");
        let folder = folder_name(dir);
        entries.push(entry(Scope::Project, format!("Project settings · {folder}"), claude.join("settings.json")));
        entries.push(entry(Scope::Local, format!("Local settings · {folder}"), claude.join("settings.local.json")));
    }
    entries
}

fn enabled_plugins(settings: &[SettingsEntry]) -> HashMap<String, bool> {
    let user = settings.iter().filter(|s| s.scope == Scope::User && s.path.ends_with("settings.json"));
    let projects: Vec<&SettingsEntry> = settings.iter().filter(|s| s.scope != Scope::User).collect();
    let mut enabled = HashMap::new();
    for entry in user.chain(projects.chunks(2).rev().flatten().copied()) {
        let map = entry.file.value.as_ref().and_then(|v| v.get("enabledPlugins")).and_then(Value::as_object);
        for (name, value) in map.into_iter().flatten() {
            enabled.insert(name.clone(), value.as_bool().unwrap_or(true));
        }
    }
    enabled
}

fn installed_plugins(ctx: &Ctx, dirs: &[PathBuf], settings: &[SettingsEntry]) -> Vec<InstalledPlugin> {
    let file = json_file(&ctx.claude_home.join("plugins").join("installed_plugins.json"));
    let Some(data) = file.value.as_ref() else { return Vec::new() };
    let enabled = enabled_plugins(settings);
    let mut plugins = Vec::new();
    for (name, entries) in data.get("plugins").and_then(Value::as_object).into_iter().flatten() {
        for entry in entries.as_array().into_iter().flatten() {
            let scope = string(entry, "scope").unwrap_or_else(|| "user".into());
            let applies = scope == "user"
                || string(entry, "projectPath").is_some_and(|p| dirs.iter().any(|d| ctx::same_path(d, &ctx.host(&p))));
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

impl Snapshot {
    pub fn load(cwd: &str) -> anyhow::Result<Self> {
        let cwd = ctx::normalize(cwd);
        let ctx = Ctx::for_cwd(&cwd)?;
        let dirs = project_dirs(&ctx, &cwd);
        let settings = settings_entries(&ctx, &dirs);
        let plugins = installed_plugins(&ctx, &dirs, &settings);
        let config_home = if ctx.claude_home == ctx.home.join(".claude") { &ctx.home } else { &ctx.claude_home };
        let claude_json_path = config_home.join(".claude.json");
        Ok(Self { claude_json: json_file(&claude_json_path), claude_json_path, settings, plugins, dirs, cwd, ctx })
    }

    pub fn native_cwd(&self) -> String {
        self.ctx.native(&self.cwd)
    }
}

fn short_plugin_name(name: &str) -> String {
    name.split('@').next().unwrap_or(name).to_string()
}

fn memory(snapshot: &Snapshot) -> Vec<MemoryFile> {
    let ctx = &snapshot.ctx;
    let mut files = vec![memory_file(Scope::User, "CLAUDE.md · all folders".into(), ctx.claude_home.join("CLAUDE.md"))];
    for (index, dir) in snapshot.dirs.iter().enumerate() {
        let folder = folder_name(dir);
        for (name, scope) in [("CLAUDE.md", Scope::Project), (".claude/CLAUDE.md", Scope::Project), ("CLAUDE.local.md", Scope::Local)] {
            let path = dir.join(name);
            if path.is_file() || (index == 0 && name == "CLAUDE.md") {
                files.push(memory_file(scope, format!("{name} · {folder}"), path));
            }
        }
    }
    let projects = ctx.claude_home.join("projects");
    let auto = std::iter::once(&snapshot.cwd)
        .chain(snapshot.dirs.iter().skip(1))
        .map(|dir| projects.join(project_key(&ctx.native(dir))).join("memory"))
        .find(|dir| dir.is_dir());
    files.extend(auto.iter().flat_map(|dir| auto_memory(dir)));
    files
}

fn settings_file(entry: &SettingsEntry) -> SettingsFile {
    let value = entry.file.value.as_ref();
    let perms = value.and_then(|v| v.get("permissions"));
    SettingsFile {
        scope: entry.scope,
        label: entry.label.clone(),
        exists: entry.file.exists,
        error: entry.file.error.clone(),
        model: value.and_then(|v| string(v, "model")),
        default_mode: perms.and_then(|p| string(p, "defaultMode")),
        allow: strings(perms.and_then(|p| p.get("allow"))),
        deny: strings(perms.and_then(|p| p.get("deny"))),
        ask: strings(perms.and_then(|p| p.get("ask"))),
        path: entry.path.to_string_lossy().to_string(),
    }
}

fn hooks_from(value: &Value, scope: Scope, plugin: Option<&str>, source: &Path, out: &mut Vec<Hook>) {
    for (event, groups) in value.get("hooks").and_then(Value::as_object).into_iter().flatten() {
        for (group, entry) in groups.as_array().into_iter().flatten().enumerate() {
            let matcher = string(entry, "matcher").filter(|m| !m.is_empty());
            for (index, hook) in entry.get("hooks").and_then(Value::as_array).into_iter().flatten().enumerate() {
                let command = string(hook, "command").or_else(|| string(hook, "prompt")).or_else(|| string(hook, "url")).unwrap_or_default();
                out.push(Hook {
                    event: event.clone(),
                    matcher: matcher.clone(),
                    command: redact::mask_text(&command),
                    scope,
                    plugin: plugin.map(str::to_string),
                    source: source.to_string_lossy().to_string(),
                    group,
                    index,
                });
            }
        }
    }
}

struct Found {
    skills: Vec<Item>,
    agents: Vec<Item>,
    commands: Vec<Item>,
    hooks: Vec<Hook>,
}

fn plugin_items(plugin: &InstalledPlugin, found: &mut Found) {
    let short = short_plugin_name(&plugin.name);
    let Found { skills, agents, commands, hooks } = found;
    skill_dirs(&plugin.root.join("skills"), Scope::Plugin, Some(&short), skills);
    let flat = Items { scope: Scope::Plugin, plugin: Some(&short), recursive: false };
    markdown_items(&plugin.root.join("agents"), "", 0, &flat, agents);
    let nested = Items { recursive: true, ..flat };
    markdown_items(&plugin.root.join("commands"), &format!("{short}:"), 0, &nested, commands);
    let hooks_file = plugin.root.join("hooks").join("hooks.json");
    if let Some(value) = json_file(&hooks_file).value.as_ref() {
        hooks_from(value, Scope::Plugin, Some(&short), &hooks_file, hooks);
    }
}

pub fn overview(cwd: &str) -> anyhow::Result<Overview> {
    let snapshot = Snapshot::load(cwd)?;
    let home = &snapshot.ctx.claude_home;

    let mut found = Found { skills: Vec::new(), agents: Vec::new(), commands: Vec::new(), hooks: Vec::new() };
    let roots = std::iter::once((home.clone(), Scope::User)).chain(snapshot.dirs.iter().map(|d| (d.join(".claude"), Scope::Project)));
    for (root, scope) in roots {
        skill_dirs(&root.join("skills"), scope, None, &mut found.skills);
        markdown_items(&root.join("agents"), "", 0, &Items { scope, plugin: None, recursive: false }, &mut found.agents);
        markdown_items(&root.join("commands"), "", 0, &Items { scope, plugin: None, recursive: true }, &mut found.commands);
    }
    for entry in &snapshot.settings {
        if let Some(value) = entry.file.value.as_ref() {
            hooks_from(value, entry.scope, None, &entry.path, &mut found.hooks);
        }
    }
    for plugin in snapshot.plugins.iter().filter(|p| p.enabled) {
        plugin_items(plugin, &mut found);
    }
    let Found { mut skills, mut agents, mut commands, hooks } = found;
    for list in [&mut skills, &mut agents, &mut commands] {
        sort_by_name(list);
    }
    let distro = snapshot.ctx.distro.clone();

    Ok(Overview {
        home: home.to_string_lossy().to_string(),
        memory: memory(&snapshot),
        mcp: describe_all(&raw_servers(&snapshot), &snapshot.native_cwd(), distro.as_deref()),
        skills,
        agents,
        commands,
        hooks,
        settings: snapshot.settings.iter().filter(|s| s.file.exists || s.scope == Scope::User).map(settings_file).collect(),
        plugins: snapshot
            .plugins
            .iter()
            .map(|p| Plugin {
                name: p.name.clone(),
                version: p.version.clone(),
                scope: p.scope.clone(),
                enabled: p.enabled,
                path: p.root.to_string_lossy().to_string(),
            })
            .collect(),
    })
}

fn server_map(value: &Value) -> Option<&Map<String, Value>> {
    value.get("mcpServers").and_then(Value::as_object).or_else(|| {
        value.as_object().filter(|m| m.values().all(|v| v.get("command").is_some() || v.get("url").is_some()))
    })
}

fn claude_json_project<'a>(snapshot: &Snapshot, root: &'a Value, dir: &Path) -> Option<&'a Value> {
    root.get("projects")?.as_object()?.iter().find(|(key, _)| ctx::same_path(&snapshot.ctx.host(key), dir)).map(|(_, v)| v)
}

fn raw_servers(snapshot: &Snapshot) -> Vec<RawServer> {
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

pub fn resolve_server(cwd: &str, id: &str) -> anyhow::Result<ResolvedServer> {
    let snapshot = Snapshot::load(cwd)?;
    servers::resolve(raw_servers(&snapshot), id, snapshot.native_cwd(), snapshot.ctx.distro.clone())
}
