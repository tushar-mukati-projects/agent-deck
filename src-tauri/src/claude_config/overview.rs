use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::Value;

use super::{
    ctx::project_key, describe, folder_name, json_file, keys, redact, servers, string, strings, InstalledPlugin, Scope,
    SettingsEntry, Snapshot,
};
use crate::util::{guarded, mtime_ms};

const MAX_COMMAND_DEPTH: usize = 8;

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
    pub error: Option<String>,
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
    pub mcp: Vec<servers::McpServer>,
    pub skills: Vec<Item>,
    pub agents: Vec<Item>,
    pub commands: Vec<Item>,
    pub hooks: Vec<Hook>,
    pub settings: Vec<SettingsFile>,
    pub plugins: Vec<Plugin>,
}

fn memory_file(scope: Scope, label: String, path: PathBuf) -> MemoryFile {
    let meta = fs::metadata(&path).ok().filter(|m| m.is_file());
    MemoryFile {
        scope,
        label,
        exists: meta.is_some(),
        size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
        modified_ms: meta.as_ref().map(mtime_ms).unwrap_or(0),
        description: meta.as_ref().and_then(|_| describe(&path).1),
        path: path.to_string_lossy().to_string(),
    }
}

fn memory(snapshot: &Snapshot) -> Vec<MemoryFile> {
    let ctx = &snapshot.ctx;
    let mut files = vec![memory_file(Scope::User, "CLAUDE.md · all folders".into(), ctx.claude_home.join("CLAUDE.md"))];
    let codex_home = ctx.var("CODEX_HOME").map(|dir| ctx.host(&dir)).unwrap_or_else(|| ctx.home.join(".codex"));
    let codex_agents = codex_home.join("AGENTS.md");
    if codex_agents.is_file() {
        files.push(memory_file(Scope::User, "AGENTS.md · Codex, all folders".into(), codex_agents));
    }
    for (index, dir) in snapshot.dirs.iter().enumerate() {
        let folder = folder_name(dir);
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
    let auto = std::iter::once(&snapshot.cwd)
        .chain(snapshot.dirs.iter().skip(1))
        .map(|dir| projects.join(project_key(&ctx.native(dir))).join("memory"))
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

struct Items<'a> {
    scope: Scope,
    plugin: Option<&'a str>,
    recursive: bool,
}

fn markdown_items(root: &Path, prefix: &str, depth: usize, spec: &Items, out: &mut Vec<Item>) {
    let Ok(entries) = fs::read_dir(root) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        let is_dir = entry.file_type().is_ok_and(|t| t.is_dir());
        if is_dir {
            if spec.recursive && depth < MAX_COMMAND_DEPTH {
                markdown_items(&path, &format!("{prefix}{stem}:"), depth + 1, spec, out);
            }
        } else if path.extension().is_some_and(|x| x == "md") {
            let (name, description) = describe(&path);
            out.push(Item {
                name: if prefix.is_empty() { name.unwrap_or(stem) } else { format!("{prefix}{stem}") },
                description,
                path: path.to_string_lossy().to_string(),
                scope: spec.scope,
                plugin: spec.plugin.map(str::to_string),
            });
        }
    }
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
        env_keys: keys(value.and_then(|v| v.get("env"))),
        path: entry.path.to_string_lossy().to_string(),
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
                    command: redact::mask_text(&command),
                    scope,
                    plugin: plugin.map(str::to_string),
                    source: source.to_string_lossy().to_string(),
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
    let short = plugin.name.split('@').next().unwrap_or(&plugin.name).to_string();
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
        list.sort_by_cached_key(|item| item.name.to_lowercase());
    }

    Ok(Overview {
        claude_home: home.to_string_lossy().to_string(),
        distro: snapshot.ctx.distro.clone(),
        memory: memory(&snapshot),
        mcp: servers::raw_servers(&snapshot).iter().map(|raw| servers::describe_server(&snapshot, raw)).collect(),
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

pub fn create_memory_file(path: &str) -> anyhow::Result<()> {
    let target = guarded(Path::new(path))?;
    let name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    anyhow::ensure!(name == "CLAUDE.md" || name == "CLAUDE.local.md", "Only CLAUDE.md files can be created here");
    anyhow::ensure!(target.parent().is_some_and(Path::is_dir), "The folder doesn't exist");
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&target)?;
    file.write_all(b"# Notes for Claude\n\n")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_folders_stop_at_max_depth() {
        let root = std::env::temp_dir().join(format!("deck-commands-{}", std::process::id()));
        let mut dir = root.clone();
        for level in 0..12 {
            dir = dir.join(format!("d{level}"));
        }
        fs::create_dir_all(&dir).unwrap();
        fs::write(root.join("top.md"), "---\ndescription: top\n---\n").unwrap();
        fs::write(dir.join("deep.md"), "x").unwrap();
        let mut out = Vec::new();
        markdown_items(&root, "", 0, &Items { scope: Scope::User, plugin: None, recursive: true }, &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].description.as_deref(), Some("top"));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn creates_only_claude_memory_files() {
        let dir = std::env::temp_dir().join(format!("deck-memory-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("CLAUDE.md");
        create_memory_file(&file.to_string_lossy()).unwrap();
        assert!(create_memory_file(&file.to_string_lossy()).is_err());
        assert!(create_memory_file(&dir.join("other.md").to_string_lossy()).is_err());
        assert!(create_memory_file(r"\\attacker\share\CLAUDE.md").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
