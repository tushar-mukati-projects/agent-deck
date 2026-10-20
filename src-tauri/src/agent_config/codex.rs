use std::{
    collections::HashSet,
    fs, io,
    path::{Path, PathBuf},
};

use serde::de::DeserializeOwned;
use serde_json::{Map, Value};
use toml_edit::{DocumentMut, TableLike};

use super::{
    ctx::Project,
    files::{folder_name, markdown_items, memory_file, rewrite_lines, skill_dirs, sort_by_name, Items},
    servers::{self, describe_all, RawServer, ResolvedServer},
    Item, MemoryFile, Overview, Plugin, Scope, SettingsFile,
};

pub const SERVER_PREFIX: &str = "codex:";

struct ConfigFile {
    scope: Scope,
    label: String,
    path: PathBuf,
    document: Option<DocumentMut>,
    error: Option<String>,
}

struct Snapshot {
    project: Project,
    home: PathBuf,
    configs: Vec<ConfigFile>,
}

fn config_file(scope: Scope, label: String, path: PathBuf) -> ConfigFile {
    let (document, error) = match fs::read_to_string(&path) {
        Ok(text) => match text.parse::<DocumentMut>() {
            Ok(document) => (Some(document), None),
            Err(error) => (None, Some(format!("Invalid TOML: {error}"))),
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => (None, None),
        Err(error) => (None, Some(error.to_string())),
    };
    ConfigFile { scope, label, path, document, error }
}

impl Snapshot {
    fn load(cwd: &str) -> anyhow::Result<Self> {
        let project = Project::load(cwd)?;
        let home = project.ctx.codex_home();
        let mut configs = vec![config_file(Scope::User, "User config".into(), home.join("config.toml"))];
        for dir in &project.dirs {
            let path = dir.join(".codex").join("config.toml");
            if path.is_file() {
                configs.push(config_file(Scope::Project, format!("Project config · {}", folder_name(dir)), path));
            }
        }
        Ok(Self { project, home, configs })
    }

    fn user_config(&self) -> Option<&DocumentMut> {
        self.configs.first().and_then(|c| c.document.as_ref())
    }
}

fn text(table: &dyn TableLike, key: &str) -> Option<String> {
    table.get(key)?.as_str().map(str::to_string)
}

fn texts(table: &dyn TableLike, key: &str) -> Vec<String> {
    let array = table.get(key).and_then(|item| item.as_array());
    array.map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default()
}

fn text_map(table: &dyn TableLike, key: &str) -> Map<String, Value> {
    let Some(inner) = table.get(key).and_then(|item| item.as_table_like()) else { return Map::new() };
    inner.iter().filter_map(|(name, value)| value.as_str().map(|v| (name.to_string(), Value::String(v.into())))).collect()
}

fn server_config(table: &dyn TableLike) -> Map<String, Value> {
    let mut config = Map::new();
    if let Some(command) = text(table, "command") {
        config.insert("command".into(), command.into());
    }
    let args = texts(table, "args");
    if !args.is_empty() {
        config.insert("args".into(), args.into());
    }
    let env = text_map(table, "env");
    if !env.is_empty() {
        config.insert("env".into(), Value::Object(env));
    }
    if let Some(url) = text(table, "url") {
        config.insert("url".into(), url.into());
    }
    let mut headers = text_map(table, "http_headers");
    for (name, variable) in text_map(table, "env_http_headers") {
        headers.insert(name, format!("${{{}}}", variable.as_str().unwrap_or_default()).into());
    }
    if let Some(variable) = text(table, "bearer_token_env_var") {
        headers.insert("Authorization".into(), format!("Bearer ${{{variable}}}").into());
    }
    if !headers.is_empty() {
        config.insert("headers".into(), Value::Object(headers));
    }
    config
}

fn raw_servers(snapshot: &Snapshot) -> Vec<RawServer> {
    let mut servers = Vec::new();
    for file in &snapshot.configs {
        let Some(tables) = file.document.as_ref().and_then(|d| d.get("mcp_servers")).and_then(|i| i.as_table_like()) else {
            continue;
        };
        for (name, item) in tables.iter() {
            let Some(table) = item.as_table_like() else { continue };
            servers.push(RawServer {
                id: format!("{SERVER_PREFIX}{}:{name}", file.scope.as_str()),
                name: name.to_string(),
                scope: file.scope,
                plugin: None,
                source: file.path.clone(),
                config: server_config(table),
                plugin_root: None,
                disabled: table.get("enabled").and_then(|v| v.as_bool()) == Some(false),
            });
        }
    }
    servers
}

fn memory(snapshot: &Snapshot) -> Vec<MemoryFile> {
    let home = &snapshot.home;
    let mut files = vec![memory_file(Scope::User, "AGENTS.md · all folders".into(), home.join("AGENTS.md"))];
    let global_override = home.join("AGENTS.override.md");
    if global_override.is_file() {
        files.push(memory_file(Scope::User, "AGENTS.override.md · all folders".into(), global_override));
    }
    for (index, dir) in snapshot.project.dirs.iter().enumerate() {
        let folder = folder_name(dir);
        for name in ["AGENTS.override.md", "AGENTS.md"] {
            let path = dir.join(name);
            if path.is_file() || (index == 0 && name == "AGENTS.md") {
                files.push(memory_file(Scope::Project, format!("{name} · {folder}"), path));
            }
        }
    }
    files
}

fn skills(snapshot: &Snapshot) -> Vec<Item> {
    let mut skills = Vec::new();
    for root in [snapshot.home.join("skills"), snapshot.project.ctx.home.join(".agents").join("skills")] {
        skill_dirs(&root, Scope::User, None, &mut skills);
    }
    skill_dirs(&snapshot.home.join("skills").join(".system"), Scope::System, None, &mut skills);
    for dir in &snapshot.project.dirs {
        for root in [dir.join(".codex").join("skills"), dir.join(".agents").join("skills")] {
            skill_dirs(&root, Scope::Project, None, &mut skills);
        }
    }
    sort_by_name(&mut skills);
    skills
}

fn prompts(snapshot: &Snapshot) -> Vec<Item> {
    let mut prompts = Vec::new();
    let spec = Items { scope: Scope::User, plugin: None, recursive: false };
    markdown_items(&snapshot.home.join("prompts"), "", 0, &spec, &mut prompts);
    sort_by_name(&mut prompts);
    prompts
}

fn value_start(text: &str, name: &str) -> Option<usize> {
    let mut from = 0;
    while let Some(found) = text[from..].find(name) {
        let end = from + found + name.len();
        if let Some(value) = text[end..].trim_start().strip_prefix('=') {
            return Some(text.len() - value.trim_start().len());
        }
        from = end;
    }
    None
}

fn parse_value<T: DeserializeOwned>(text: &str) -> Option<(T, usize)> {
    let mut stream = serde_json::Deserializer::from_str(text).into_iter::<T>();
    let value = stream.next()?.ok()?;
    Some((value, stream.byte_offset()))
}

fn prefix_rule(line: &str) -> Option<(Vec<String>, String)> {
    let call = line.trim().strip_prefix("prefix_rule(")?.strip_suffix(')')?;
    let start = value_start(call, "pattern")?;
    let (words, length) = parse_value::<Vec<String>>(&call[start..])?;
    let outside = format!("{} {}", &call[..start], &call[start + length..]);
    let decision = match value_start(&outside, "decision") {
        Some(at) => parse_value::<String>(&outside[at..])?.0,
        None => "allow".to_string(),
    };
    Some((words, decision))
}

fn rule_list(decision: &str) -> Option<&'static str> {
    match decision {
        "allow" => Some("allow"),
        "prompt" => Some("ask"),
        "forbidden" => Some("deny"),
        _ => None,
    }
}

fn rules_file(path: &Path) -> SettingsFile {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let mut file = SettingsFile { label: format!("Rules · {name}"), path: path.to_string_lossy().to_string(), exists: true, ..Default::default() };
    let text = fs::read_to_string(path).unwrap_or_default();
    for (words, decision) in text.lines().filter_map(prefix_rule) {
        let rule = words.join(" ");
        match rule_list(&decision) {
            Some("allow") => file.allow.push(rule),
            Some("ask") => file.ask.push(rule),
            Some("deny") => file.deny.push(rule),
            _ => {}
        }
    }
    file
}

fn settings(snapshot: &Snapshot) -> Vec<SettingsFile> {
    let mut files: Vec<SettingsFile> = snapshot
        .configs
        .iter()
        .map(|config| {
            let value = |key: &str| config.document.as_ref().and_then(|d| d.get(key)).and_then(|i| i.as_str()).map(str::to_string);
            SettingsFile {
                scope: config.scope,
                label: config.label.clone(),
                path: config.path.to_string_lossy().to_string(),
                exists: config.path.is_file(),
                error: config.error.clone(),
                model: value("model"),
                default_mode: value("approval_policy"),
                ..Default::default()
            }
        })
        .collect();
    let mut rules: Vec<PathBuf> = fs::read_dir(snapshot.home.join("rules"))
        .map(|entries| entries.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "rules")).collect())
        .unwrap_or_default();
    rules.sort();
    files.extend(rules.iter().map(|path| rules_file(path)));
    files
}

fn plugin_cache(home: &Path, name: &str) -> Option<PathBuf> {
    let (plugin, marketplace) = name.split_once('@')?;
    let safe = |part: &str| !part.is_empty() && part != "." && part != ".." && !part.contains(['/', '\\']);
    (safe(plugin) && safe(marketplace)).then(|| home.join("plugins").join("cache").join(marketplace).join(plugin))
}

fn plugins(snapshot: &Snapshot) -> Vec<Plugin> {
    let Some(table) = snapshot.user_config().and_then(|d| d.get("plugins")).and_then(|i| i.as_table_like()) else {
        return Vec::new();
    };
    table
        .iter()
        .map(|(name, item)| {
            let cache = plugin_cache(&snapshot.home, name).filter(|dir| dir.is_dir());
            Plugin {
                name: name.to_string(),
                version: None,
                scope: "user".into(),
                enabled: item.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true),
                path: cache.unwrap_or_else(|| snapshot.home.clone()).to_string_lossy().to_string(),
            }
        })
        .collect()
}

pub fn overview(cwd: &str) -> anyhow::Result<Overview> {
    let snapshot = Snapshot::load(cwd)?;
    let distro = snapshot.project.ctx.distro.clone();
    Ok(Overview {
        home: snapshot.home.to_string_lossy().to_string(),
        memory: memory(&snapshot),
        mcp: describe_all(&raw_servers(&snapshot), &snapshot.project.native_cwd(), distro.as_deref()),
        skills: skills(&snapshot),
        agents: Vec::new(),
        commands: prompts(&snapshot),
        hooks: Vec::new(),
        settings: settings(&snapshot),
        plugins: plugins(&snapshot),
    })
}

pub fn resolve_server(cwd: &str, id: &str) -> anyhow::Result<ResolvedServer> {
    let snapshot = Snapshot::load(cwd)?;
    servers::resolve(raw_servers(&snapshot), id, snapshot.project.native_cwd(), snapshot.project.ctx.distro.clone())
}

fn edit_config(path: &Path, change: impl FnOnce(&mut DocumentMut) -> bool) -> anyhow::Result<()> {
    let mut document: DocumentMut = fs::read_to_string(path)?.parse()?;
    anyhow::ensure!(change(&mut document), "It's no longer in {}", path.display());
    fs::write(path, document.to_string())?;
    Ok(())
}

fn remove_entry(document: &mut DocumentMut, table: &str, name: &str) -> bool {
    let Some(entries) = document.get_mut(table).and_then(|item| item.as_table_like_mut()) else { return false };
    let removed = entries.remove(name).is_some();
    if entries.is_empty() {
        document.remove(table);
    }
    removed
}

pub fn remove_server(config: &Path, name: &str) -> anyhow::Result<()> {
    edit_config(config, |document| remove_entry(document, "mcp_servers", name))
}

pub fn remove_plugin(home: &Path, name: &str) -> anyhow::Result<Option<PathBuf>> {
    edit_config(&home.join("config.toml"), |document| remove_entry(document, "plugins", name))?;
    Ok(plugin_cache(home, name))
}

fn rule_words(line: &str, list: &str, rule: &str) -> Option<Vec<String>> {
    prefix_rule(line).filter(|(words, decision)| words.join(" ") == rule && rule_list(decision) == Some(list)).map(|(words, _)| words)
}

pub fn remove_rule(path: &Path, list: &str, rule: &str) -> anyhow::Result<()> {
    let text = fs::read_to_string(path)?;
    let patterns: HashSet<Vec<String>> = text.lines().filter_map(|line| rule_words(line, list, rule)).collect();
    anyhow::ensure!(!patterns.is_empty(), "That rule is no longer in {}", path.display());
    anyhow::ensure!(patterns.len() == 1, "Several rules read as {rule}; remove the right one in {} by hand", path.display());
    let mut removed = false;
    rewrite_lines(path, |line| {
        let matches = !removed && rule_words(line, list, rule).is_some();
        removed |= matches;
        !matches
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(line: &str) -> Option<(String, String)> {
        prefix_rule(line).map(|(words, decision)| (words.join(" "), decision))
    }

    #[test]
    fn reads_prefix_rules() {
        let line = r#"prefix_rule(pattern=["git", "-C", "/r]x", "status"], decision="prompt")"#;
        assert_eq!(rule(line), Some(("git -C /r]x status".into(), "prompt".into())));
        assert_eq!(rule(r#"prefix_rule(pattern=["ls"])"#), Some(("ls".into(), "allow".into())));
        assert_eq!(rule(r#"prefix_rule(pattern = ["rm"], decision = "forbidden")"#), Some(("rm".into(), "forbidden".into())));
        assert_eq!(rule(r#"prefix_rule(decision="forbidden", pattern=["rm"])"#), Some(("rm".into(), "forbidden".into())));
        assert_eq!(rule(r#"prefix_rule(pattern=["echo", "decision=x"], decision="prompt")"#), Some(("echo decision=x".into(), "prompt".into())));
        assert_eq!(rule(r#"prefix_rule(pattern=["rm"],"#), None);
        assert_eq!(rule(r#"prefix_rule(pattern=["rm"], decision=forbidden)"#), None);
        assert_eq!(rule("# comment"), None);
    }

    #[test]
    fn maps_server_tables_to_launch_config() {
        let document: DocumentMut = r#"
[mcp_servers.pg]
command = "npx"
args = ["-y", "pg"]
env = { PG_PASSWORD = "secret" }

[mcp_servers.remote]
url = "https://example.com/mcp"
bearer_token_env_var = "TOKEN"
enabled = false
"#
        .parse()
        .unwrap();
        let servers = document["mcp_servers"].as_table_like().unwrap();
        let pg = server_config(servers.get("pg").unwrap().as_table_like().unwrap());
        assert_eq!(pg["command"], "npx");
        assert_eq!(pg["args"], serde_json::json!(["-y", "pg"]));
        assert_eq!(pg["env"]["PG_PASSWORD"], "secret");
        let remote = server_config(servers.get("remote").unwrap().as_table_like().unwrap());
        assert_eq!(remote["headers"]["Authorization"], "Bearer ${TOKEN}");
    }

    #[test]
    fn plugin_caches_stay_inside_the_cache_folder() {
        let home = Path::new("/h");
        assert_eq!(plugin_cache(home, "a@m"), Some(home.join("plugins").join("cache").join("m").join("a")));
        for name in ["a", "a@", "@m", "..@m", "a@..", "a/b@m", r"a@m\x"] {
            assert_eq!(plugin_cache(home, name), None, "{name}");
        }
    }

    #[test]
    fn removes_servers_plugins_and_rules_in_place() {
        let dir = std::env::temp_dir().join(format!("deck-codex-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let config = dir.join("config.toml");
        fs::write(
            &config,
            "# mine\nmodel = \"m\"\n\n[plugins.\"a@m\"]\nenabled = true\n\n[mcp_servers.x]\ncommand = \"x\"\n\n[mcp_servers.x.env]\nK = \"v\"\n\n[mcp_servers.y]\ncommand = \"y\"\n",
        )
        .unwrap();
        remove_server(&config, "x").unwrap();
        assert!(remove_server(&config, "x").is_err());
        let cache = remove_plugin(&dir, "a@m").unwrap();
        assert_eq!(cache, Some(dir.join("plugins").join("cache").join("m").join("a")));
        let text = fs::read_to_string(&config).unwrap();
        assert!(text.starts_with("# mine\nmodel = \"m\"\n"));
        assert!(!text.contains("[mcp_servers.x") && !text.contains("plugins") && text.contains("[mcp_servers.y]"));

        let rules = dir.join("default.rules");
        fs::write(&rules, "prefix_rule(pattern=[\"ls\"], decision=\"allow\")\r\nprefix_rule(pattern=[\"rm\"], decision=\"forbidden\")\r\n").unwrap();
        assert!(remove_rule(&rules, "allow", "rm").is_err());
        remove_rule(&rules, "deny", "rm").unwrap();
        assert_eq!(fs::read_to_string(&rules).unwrap(), "prefix_rule(pattern=[\"ls\"], decision=\"allow\")\r\n");
        fs::write(&rules, "prefix_rule(pattern=[\"git a\", \"b\"])\nprefix_rule(pattern=[\"git\", \"a b\"])\n").unwrap();
        assert!(remove_rule(&rules, "allow", "git a b").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
