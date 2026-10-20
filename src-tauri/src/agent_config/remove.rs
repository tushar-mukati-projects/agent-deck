use std::{fs, path::Path, process::Command, time::Duration};

use anyhow::Context;
use serde::Deserialize;
use serde_json::Value;

use super::{codex, files::rewrite_lines, overview, Agent, Item, Scope};
use crate::{
    pty::resolve_program,
    util::run_with_timeout,
    wsl,
};

const CLI_TIMEOUT: Duration = Duration::from_secs(60);
const GONE: &str = "It's no longer there. Refresh and try again.";

#[derive(Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Removal {
    Memory { path: String },
    Skill { path: String },
    File { path: String },
    McpServer { id: String },
    Hook { source: String, event: String, group: usize, index: usize, command: String },
    Rule { path: String, list: String, rule: String },
    Plugin { name: String },
}

pub fn remove(cwd: &str, agent: Agent, removal: Removal) -> anyhow::Result<()> {
    let listed = overview(cwd, agent)?;
    match removal {
        Removal::Memory { path } => {
            let file = listed.memory.iter().find(|m| m.exists && m.path == path).context(GONE)?;
            discard(Path::new(&path))?;
            if file.scope == Scope::Auto {
                unlink_from_index(Path::new(&path))?;
            }
            Ok(())
        }
        Removal::Skill { path } => {
            listed_item(&listed.skills, &path).context(GONE)?;
            discard(Path::new(&path).parent().context(GONE)?)
        }
        Removal::File { path } => {
            listed_item(&listed.agents, &path).or_else(|| listed_item(&listed.commands, &path)).context(GONE)?;
            discard(Path::new(&path))
        }
        Removal::McpServer { id } => {
            let server = listed.mcp.iter().find(|s| s.id == id && s.scope.removable()).context(GONE)?;
            let source = Path::new(&server.source);
            match agent {
                Agent::Claude => {
                    let dir = if server.scope == Scope::Project { source.parent().map(Path::to_string_lossy) } else { None };
                    let dir = dir.map(|d| d.to_string()).unwrap_or_else(|| cwd.to_string());
                    claude_cli(&dir, &["mcp", "remove", &server.name, "--scope", server.scope.as_str()])
                }
                Agent::Codex => codex::remove_server(source, &server.name),
            }
        }
        Removal::Hook { source, event, group, index, command } => {
            let found = listed.hooks.iter().any(|h| {
                h.scope.removable() && h.source == source && h.event == event && h.group == group && h.index == index && h.command == command
            });
            anyhow::ensure!(found, GONE);
            edit_json(Path::new(&source), |settings| remove_hook(settings, &event, group, index))
        }
        Removal::Rule { path, list, rule } => {
            let file = listed.settings.iter().find(|s| s.path == path).context(GONE)?;
            let rules = match list.as_str() {
                "allow" => &file.allow,
                "ask" => &file.ask,
                "deny" => &file.deny,
                _ => anyhow::bail!("Unknown rule list {list}"),
            };
            anyhow::ensure!(rules.contains(&rule), GONE);
            match agent {
                Agent::Claude => edit_json(Path::new(&path), |settings| remove_rule(settings, &list, &rule)),
                Agent::Codex => codex::remove_rule(Path::new(&path), &list, &rule),
            }
        }
        Removal::Plugin { name } => {
            let plugin = listed.plugins.iter().find(|p| p.name == name).context(GONE)?;
            match agent {
                Agent::Claude => claude_cli(cwd, &["plugin", "uninstall", &name, "--scope", &plugin.scope]),
                Agent::Codex => match codex::remove_plugin(Path::new(&listed.home), &name)? {
                    Some(cache) if cache.is_dir() => discard(&cache),
                    _ => Ok(()),
                },
            }
        }
    }
}

fn listed_item<'a>(items: &'a [Item], path: &str) -> Option<&'a Item> {
    items.iter().find(|item| item.path == path && item.scope.removable())
}

fn discard(path: &Path) -> anyhow::Result<()> {
    if wsl::parse_host_path(&path.to_string_lossy()).is_none() {
        return trash::delete(path).context("Couldn't move it to the Recycle Bin");
    }
    if path.is_dir() {
        fs::remove_dir_all(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn unlink_from_index(memory: &Path) -> anyhow::Result<()> {
    let Some(name) = memory.file_name().and_then(|n| n.to_str()) else { return Ok(()) };
    let index = memory.with_file_name("MEMORY.md");
    if name == "MEMORY.md" || !index.is_file() {
        return Ok(());
    }
    let link = format!("]({name})");
    rewrite_lines(&index, |line| !(line.trim_start().starts_with("- [") && line.contains(&link)))?;
    Ok(())
}

fn edit_json(path: &Path, change: impl FnOnce(&mut Value) -> bool) -> anyhow::Result<()> {
    let mut settings: Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    anyhow::ensure!(change(&mut settings), GONE);
    fs::write(path, serde_json::to_string_pretty(&settings)? + "\n")?;
    Ok(())
}

fn remove_hook(settings: &mut Value, event: &str, group: usize, index: usize) -> bool {
    let Some(hooks) = settings.get_mut("hooks").and_then(Value::as_object_mut) else { return false };
    let Some(groups) = hooks.get_mut(event).and_then(Value::as_array_mut) else { return false };
    let Some(list) = groups.get_mut(group).and_then(|g| g.get_mut("hooks")).and_then(Value::as_array_mut) else { return false };
    if index >= list.len() {
        return false;
    }
    list.remove(index);
    if list.is_empty() {
        groups.remove(group);
    }
    if groups.is_empty() {
        hooks.shift_remove(event);
    }
    if hooks.is_empty() {
        settings.as_object_mut().map(|object| object.shift_remove("hooks"));
    }
    true
}

fn remove_rule(settings: &mut Value, list: &str, rule: &str) -> bool {
    let Some(permissions) = settings.get_mut("permissions").and_then(Value::as_object_mut) else { return false };
    let Some(rules) = permissions.get_mut(list).and_then(Value::as_array_mut) else { return false };
    let Some(position) = rules.iter().position(|r| r.as_str() == Some(rule)) else { return false };
    rules.remove(position);
    if rules.is_empty() {
        permissions.shift_remove(list);
    }
    if permissions.is_empty() {
        settings.as_object_mut().map(|object| object.shift_remove("permissions"));
    }
    true
}

fn claude_cli(dir: &str, args: &[&str]) -> anyhow::Result<()> {
    anyhow::ensure!(Path::new(dir).is_dir(), "{dir} isn't reachable");
    let mut command = match wsl::parse_host_path(dir) {
        Some((distro, linux)) => {
            wsl::login_command(&distro, &linux, "claude", args)
        }
        None => {
            let mut command = Command::new(resolve_program("claude")?);
            command.args(args).current_dir(dir);
            command
        }
    };
    let output = run_with_timeout(&mut command, None, CLI_TIMEOUT)?;
    if output.status.success() {
        return Ok(());
    }
    let text = wsl::decode_output(if output.stderr.is_empty() { &output.stdout } else { &output.stderr });
    anyhow::bail!("{}", text.trim().lines().last().unwrap_or("claude failed"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn removes_a_hook_and_empty_parents_but_keeps_key_order() {
        let mut settings = json!({
            "model": "m",
            "hooks": { "Stop": [{ "hooks": [{ "command": "a" }] }], "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "command": "b" }, { "command": "c" }] }] },
            "env": {}
        });
        assert!(remove_hook(&mut settings, "PreToolUse", 0, 1));
        assert_eq!(settings["hooks"]["PreToolUse"][0]["hooks"], json!([{ "command": "b" }]));
        assert!(remove_hook(&mut settings, "Stop", 0, 0));
        assert!(!remove_hook(&mut settings, "Stop", 0, 0));
        assert!(remove_hook(&mut settings, "PreToolUse", 0, 0));
        assert_eq!(serde_json::to_string(&settings).unwrap(), r#"{"model":"m","env":{}}"#);
    }

    #[test]
    fn removes_permission_rules() {
        let mut settings = json!({ "permissions": { "allow": ["Bash(ls)", "Read"], "deny": ["WebFetch"] } });
        assert!(remove_rule(&mut settings, "allow", "Read"));
        assert!(!remove_rule(&mut settings, "allow", "Read"));
        assert!(remove_rule(&mut settings, "deny", "WebFetch"));
        assert_eq!(settings, json!({ "permissions": { "allow": ["Bash(ls)"] } }));
        assert!(remove_rule(&mut settings, "allow", "Bash(ls)"));
        assert_eq!(settings, json!({}));
    }

    #[test]
    fn unlinks_auto_memory_from_its_index() {
        let dir = std::env::temp_dir().join(format!("deck-unlink-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("MEMORY.md"), "# Index\r\n- [A](a.md) — one\r\n- [B](b.md) — two, see [A](a.md)\r\n").unwrap();
        unlink_from_index(&dir.join("a.md")).unwrap();
        assert_eq!(fs::read_to_string(dir.join("MEMORY.md")).unwrap(), "# Index\r\n");
        fs::write(dir.join("MEMORY.md"), "# Index\n- [A](a.md) — one\n- [B](b.md) — two\n").unwrap();
        unlink_from_index(&dir.join("a.md")).unwrap();
        assert_eq!(fs::read_to_string(dir.join("MEMORY.md")).unwrap(), "# Index\n- [B](b.md) — two\n");
        fs::remove_dir_all(&dir).unwrap();
    }
}
