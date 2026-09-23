use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::Value;

use crate::util::path_mtime_ms;

const SKIP_DIRS: &[&str] = &["node_modules", ".git", "target", "dist", "build", ".next", ".venv", "__pycache__"];
const TASK_SCAN_DEPTH: usize = 3;
const MEDIA_LIMIT: usize = 4000;
const SEQUENCE_MIN_IMAGES: usize = 40;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPackage {
    pub dir: String,
    pub name: String,
    pub scripts: Vec<TaskScript>,
    pub runner: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskScript {
    pub name: String,
    pub command: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectAgent {
    pub name: String,
    pub description: Option<String>,
    pub path: String,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    Video,
    Image,
    Audio,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaItem {
    pub path: String,
    pub kind: MediaKind,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSequence {
    pub dir: String,
    pub count: usize,
    pub sample: String,
    pub modified_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaIndex {
    pub items: Vec<MediaItem>,
    pub sequences: Vec<MediaSequence>,
    pub truncated: bool,
}

fn is_skipped(name: &str) -> bool {
    SKIP_DIRS.contains(&name)
}

fn detect_runner(dir: &Path) -> &'static str {
    if dir.join("pnpm-lock.yaml").is_file() {
        "pnpm"
    } else if dir.join("yarn.lock").is_file() {
        "yarn"
    } else if dir.join("bun.lockb").is_file() || dir.join("bun.lock").is_file() {
        "bun"
    } else {
        "npm"
    }
}

fn read_package(dir: &Path) -> Option<TaskPackage> {
    let text = fs::read_to_string(dir.join("package.json")).ok()?;
    let json: Value = serde_json::from_str(&text).ok()?;
    let scripts: Vec<TaskScript> = json
        .get("scripts")?
        .as_object()?
        .iter()
        .filter_map(|(name, command)| Some(TaskScript { name: name.clone(), command: command.as_str()?.to_string() }))
        .collect();
    if scripts.is_empty() {
        return None;
    }
    let name = json
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
    Some(TaskPackage { dir: dir.to_string_lossy().to_string(), name, scripts, runner: detect_runner(dir).to_string() })
}

fn collect_packages(dir: &Path, depth: usize, out: &mut Vec<TaskPackage>) {
    if let Some(package) = read_package(dir) {
        out.push(package);
    }
    if depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut children: Vec<PathBuf> = entries
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            !name.starts_with('.') && !is_skipped(&name)
        })
        .map(|e| e.path())
        .collect();
    children.sort();
    for child in children {
        collect_packages(&child, depth - 1, out);
    }
}

pub fn tasks(root: &str) -> Vec<TaskPackage> {
    let mut packages = Vec::new();
    collect_packages(Path::new(root), TASK_SCAN_DEPTH, &mut packages);
    packages
}

fn frontmatter(text: &str) -> HashMap<String, String> {
    let mut fields = HashMap::new();
    let Some(rest) = text.strip_prefix("---") else { return fields };
    let Some(end) = rest.find("\n---") else { return fields };
    for line in rest[..end].lines() {
        if let Some((key, value)) = line.split_once(':') {
            let value = value.trim().trim_matches('"').trim_matches('\'');
            if !value.is_empty() {
                fields.insert(key.trim().to_string(), value.to_string());
            }
        }
    }
    fields
}

pub fn agents(root: &str) -> Vec<ProjectAgent> {
    let dir = Path::new(root).join(".claude").join("agents");
    let Ok(entries) = fs::read_dir(&dir) else { return Vec::new() };
    let mut agents: Vec<ProjectAgent> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "md"))
        .filter_map(|path| {
            let text = fs::read_to_string(&path).ok()?;
            let fields = frontmatter(&text);
            let fallback = path.file_stem()?.to_string_lossy().to_string();
            Some(ProjectAgent {
                name: fields.get("name").cloned().unwrap_or(fallback),
                description: fields.get("description").cloned(),
                path: path.to_string_lossy().to_string(),
            })
        })
        .collect();
    agents.sort_by(|a, b| a.name.cmp(&b.name));
    agents
}

fn media_kind(path: &Path) -> Option<MediaKind> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    match ext.as_str() {
        "mp4" | "webm" | "mov" | "m4v" | "mkv" => Some(MediaKind::Video),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "avif" | "svg" | "bmp" => Some(MediaKind::Image),
        "mp3" | "wav" | "ogg" | "m4a" | "flac" | "aac" => Some(MediaKind::Audio),
        _ => None,
    }
}

pub fn media(root: &str) -> MediaIndex {
    let mut by_dir: BTreeMap<PathBuf, Vec<(PathBuf, MediaKind, u64)>> = BTreeMap::new();
    let mut total = 0usize;
    let mut truncated = false;
    let walker = ignore::WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(false)
        .filter_entry(|e| !e.file_name().to_str().is_some_and(is_skipped))
        .build();
    for entry in walker.flatten() {
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let path = entry.path();
        let Some(kind) = media_kind(path) else { continue };
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
        by_dir.entry(parent).or_default().push((path.to_path_buf(), kind, size));
        total += 1;
        if total >= 200_000 {
            truncated = true;
            break;
        }
    }

    let mut items = Vec::new();
    let mut sequences = Vec::new();
    for (dir, files) in by_dir {
        let images = files.iter().filter(|(_, kind, _)| *kind == MediaKind::Image).count();
        if images >= SEQUENCE_MIN_IMAGES {
            let mut sorted: Vec<_> = files.iter().filter(|(_, kind, _)| *kind == MediaKind::Image).collect();
            sorted.sort_by(|a, b| a.0.cmp(&b.0));
            sequences.push(MediaSequence {
                dir: dir.to_string_lossy().to_string(),
                count: images,
                sample: sorted[sorted.len() / 2].0.to_string_lossy().to_string(),
                modified_ms: path_mtime_ms(&dir),
            });
            items.extend(files.into_iter().filter(|(_, kind, _)| *kind != MediaKind::Image).map(|(path, kind, size)| {
                MediaItem { modified_ms: path_mtime_ms(&path), path: path.to_string_lossy().to_string(), kind, size }
            }));
            continue;
        }
        items.extend(files.into_iter().map(|(path, kind, size)| MediaItem {
            modified_ms: path_mtime_ms(&path),
            path: path.to_string_lossy().to_string(),
            kind,
            size,
        }));
    }
    items.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    if items.len() > MEDIA_LIMIT {
        items.truncate(MEDIA_LIMIT);
        truncated = true;
    }
    sequences.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    MediaIndex { items, sequences, truncated }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_agent_frontmatter() {
        let fields = frontmatter("---\nname: shorts-agent\ndescription: \"Makes shorts\"\n---\nbody");
        assert_eq!(fields.get("name").map(String::as_str), Some("shorts-agent"));
        assert_eq!(fields.get("description").map(String::as_str), Some("Makes shorts"));
    }

    #[test]
    #[ignore]
    fn probe_site_folder() {
        let root = dirs::home_dir().unwrap().join("my-files").join("site");
        let root = root.to_string_lossy().to_string();
        let start = std::time::Instant::now();
        let packages = tasks(&root);
        println!("packages={} in {:?}", packages.len(), start.elapsed());
        for p in &packages {
            println!("  {} ({}) scripts={}", p.name, p.runner, p.scripts.iter().map(|s| s.name.as_str()).collect::<Vec<_>>().join(","));
        }
        println!("agents={:?}", agents(&root).iter().map(|a| &a.name).collect::<Vec<_>>());
        let start = std::time::Instant::now();
        let index = media(&root);
        println!(
            "media items={} sequences={} truncated={} in {:?}",
            index.items.len(),
            index.sequences.len(),
            index.truncated,
            start.elapsed()
        );
        for item in index.items.iter().filter(|i| i.kind == MediaKind::Video).take(5) {
            println!("  video {}", item.path);
        }
    }
}
