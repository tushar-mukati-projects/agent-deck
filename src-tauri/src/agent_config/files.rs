use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, LazyLock},
};

use parking_lot::Mutex;
use serde_json::Value;

use super::{Item, MemoryFile, Scope};
use crate::util::{guarded, mtime_ms};

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
const MAX_COMMAND_DEPTH: usize = 8;
const MEMORY_FILES: &[(&str, &str)] =
    &[("CLAUDE.md", "# Notes for Claude\n\n"), ("CLAUDE.local.md", "# Notes for Claude\n\n"), ("AGENTS.md", "# Notes for agents\n\n")];

fn stamp(path: &Path) -> Option<Stamp> {
    let meta = fs::metadata(path).ok().filter(|m| m.is_file())?;
    Some((meta.len(), mtime_ms(&meta)))
}

fn cached<T>(cache: &Cached<T>, path: &Path, missing: impl FnOnce() -> T, load: impl FnOnce() -> T) -> Arc<T> {
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

pub fn string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

pub fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

pub fn keys(value: Option<&Value>) -> Vec<String> {
    value.and_then(Value::as_object).map(|m| m.keys().cloned().collect()).unwrap_or_default()
}

pub fn folder_name(dir: &Path) -> String {
    dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| dir.to_string_lossy().to_string())
}

pub fn memory_file(scope: Scope, label: String, path: PathBuf) -> MemoryFile {
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

pub fn auto_memory(dir: &Path) -> Vec<MemoryFile> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "md")).collect())
        .unwrap_or_default();
    entries.sort_by_key(|p| (p.file_name().is_none_or(|n| n != "MEMORY.md"), p.clone()));
    entries
        .into_iter()
        .map(|path| {
            let label = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            memory_file(Scope::Auto, label, path)
        })
        .collect()
}

pub fn skill_dirs(root: &Path, scope: Scope, plugin: Option<&str>, out: &mut Vec<Item>) {
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

pub struct Items<'a> {
    pub scope: Scope,
    pub plugin: Option<&'a str>,
    pub recursive: bool,
}

pub fn markdown_items(root: &Path, prefix: &str, depth: usize, spec: &Items, out: &mut Vec<Item>) {
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

pub fn sort_by_name(items: &mut [Item]) {
    items.sort_by_cached_key(|item| item.name.to_lowercase());
}

pub fn rewrite_lines(path: &Path, mut keep: impl FnMut(&str) -> bool) -> anyhow::Result<usize> {
    let text = fs::read_to_string(path)?;
    let mut removed = 0;
    let kept: String = text
        .split_inclusive('\n')
        .filter(|line| {
            let kept = keep(line.trim_end_matches(['\r', '\n']));
            removed += usize::from(!kept);
            kept
        })
        .collect();
    if removed > 0 {
        fs::write(path, kept)?;
    }
    Ok(removed)
}

pub fn create_memory_file(path: &str) -> anyhow::Result<()> {
    let target = guarded(Path::new(path))?;
    let name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let (_, template) = MEMORY_FILES
        .iter()
        .find(|(file, _)| *file == name)
        .ok_or_else(|| anyhow::anyhow!("Only CLAUDE.md and AGENTS.md files can be created here"))?;
    anyhow::ensure!(target.parent().is_some_and(Path::is_dir), "The folder doesn't exist");
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&target)?;
    file.write_all(template.as_bytes())?;
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
    fn rewrites_lines_and_keeps_their_endings() {
        let path = std::env::temp_dir().join(format!("deck-lines-{}.txt", std::process::id()));
        fs::write(&path, "a\r\nb\r\nc").unwrap();
        assert_eq!(rewrite_lines(&path, |line| line != "b").unwrap(), 1);
        assert_eq!(fs::read_to_string(&path).unwrap(), "a\r\nc");
        assert_eq!(rewrite_lines(&path, |_| true).unwrap(), 0);
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn creates_only_known_memory_files() {
        let dir = std::env::temp_dir().join(format!("deck-memory-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("CLAUDE.md");
        create_memory_file(&file.to_string_lossy()).unwrap();
        assert!(create_memory_file(&file.to_string_lossy()).is_err());
        create_memory_file(&dir.join("AGENTS.md").to_string_lossy()).unwrap();
        assert!(fs::read_to_string(dir.join("AGENTS.md")).unwrap().starts_with("# Notes for agents"));
        assert!(create_memory_file(&dir.join("other.md").to_string_lossy()).is_err());
        assert!(create_memory_file(r"\\attacker\share\CLAUDE.md").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }
}
