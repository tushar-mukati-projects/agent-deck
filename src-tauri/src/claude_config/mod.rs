mod ctx;
mod overview;
mod redact;
mod servers;

use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, LazyLock},
};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::util::mtime_ms;

pub use overview::{create_memory_file, overview, Overview};
pub use redact::url_host;
pub use servers::{launch, resolve_server, Launch, ResolvedServer, Transport};

use ctx::{project_dirs, Ctx};

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

#[derive(Default)]
pub struct JsonFile {
    pub exists: bool,
    pub value: Option<Value>,
    pub error: Option<String>,
}

type Stamp = (u64, u64);
type Cached<T> = Mutex<HashMap<PathBuf, (Stamp, Arc<T>)>>;

static JSON_CACHE: LazyLock<Cached<JsonFile>> = LazyLock::new(Mutex::default);
static HEAD_CACHE: LazyLock<Cached<HashMap<String, String>>> = LazyLock::new(Mutex::default);
const FRONTMATTER_BYTES: u64 = 16 * 1024;

fn stamp(path: &Path) -> Option<Stamp> {
    let meta = fs::metadata(path).ok().filter(|m| m.is_file())?;
    Some((meta.len(), mtime_ms(&meta)))
}

fn cached<T>(
    cache: &Cached<T>,
    path: &Path,
    missing: impl FnOnce() -> T,
    load: impl FnOnce() -> T,
) -> Arc<T> {
    let Some(current) = stamp(path) else { return Arc::new(missing()) };
    if let Some((seen, value)) = cache.lock().get(path) {
        if *seen == current {
            return value.clone();
        }
    }
    let value = Arc::new(load());
    cache.lock().insert(path.to_path_buf(), (current, value.clone()));
    value
}

pub fn json_file(path: &Path) -> Arc<JsonFile> {
    cached(&JSON_CACHE, path, JsonFile::default, || match fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(value) => JsonFile { exists: true, value: Some(value), error: None },
            Err(error) => JsonFile { exists: true, value: None, error: Some(format!("Invalid JSON: {error}")) },
        },
        Err(error) => JsonFile { exists: true, value: None, error: Some(error.to_string()) },
    })
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

fn is_block_indicator(value: &str) -> bool {
    matches!(value, "|" | ">" | "|-" | ">-" | "|+" | ">+")
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
                let value = value.trim();
                let value = if is_block_indicator(value) { String::new() } else { unquote(value) };
                let key = key.trim().to_string();
                fields.insert(key.clone(), value);
                last = Some(key);
            }
            _ => {
                let Some(existing) = last.as_ref().filter(|_| indented).and_then(|key| fields.get_mut(key)) else { continue };
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
    fields
}

fn head_text(path: &Path) -> String {
    let mut bytes = Vec::new();
    let _ = fs::File::open(path).and_then(|f| f.take(FRONTMATTER_BYTES).read_to_end(&mut bytes));
    String::from_utf8_lossy(&bytes).into_owned()
}

pub fn describe(path: &Path) -> (Option<String>, Option<String>) {
    let fields = cached(&HEAD_CACHE, path, HashMap::new, || frontmatter(&head_text(path)));
    let description = fields.get("description").filter(|d| !d.is_empty()).map(|d| {
        if d.chars().count() > 400 {
            d.chars().take(400).collect::<String>() + "…"
        } else {
            d.clone()
        }
    });
    (fields.get("name").filter(|n| !n.is_empty()).cloned(), description)
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

fn folder_name(dir: &Path) -> String {
    dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| dir.to_string_lossy().to_string())
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
        let claude_json_path = ctx.home.join(".claude.json");
        Ok(Self { claude_json: json_file(&claude_json_path), claude_json_path, settings, plugins, dirs, cwd, ctx })
    }
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
    fn frontmatter_reads_block_scalars() {
        let fields = frontmatter("---\nname: x\ndescription: >-\n  folded\n  text\nnotes: |\n  kept\n---\n");
        assert_eq!(fields["description"], "folded text");
        assert_eq!(fields["notes"], "kept");
    }

    #[test]
    fn caches_json_until_the_file_changes() {
        let dir = std::env::temp_dir().join(format!("deck-json-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        assert!(!json_file(&path).exists);
        fs::write(&path, "{\"model\":\"a\"}").unwrap();
        let first = json_file(&path);
        assert!(Arc::ptr_eq(&first, &json_file(&path)));
        fs::write(&path, "{broken").unwrap();
        let broken = json_file(&path);
        assert!(broken.exists && broken.value.is_none() && broken.error.is_some());
        fs::remove_dir_all(&dir).unwrap();
    }
}
