use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use anyhow::Context;
use serde::Serialize;

const MAX_TEXT_BYTES: u64 = 8 * 1024 * 1024;
const SNIFF_BYTES: usize = 8 * 1024;
const QUICK_OPEN_LIMIT: usize = 60_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub hidden: bool,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileContent {
    Text { text: String, size: u64 },
    Binary { size: u64 },
    TooLarge { size: u64 },
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(windows)]
fn is_hidden(name: &str, meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    name.starts_with('.') || meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

#[cfg(not(windows))]
fn is_hidden(name: &str, _meta: &fs::Metadata) -> bool {
    name.starts_with('.')
}

pub fn list_dir(path: &str) -> anyhow::Result<Vec<DirEntry>> {
    let mut entries: Vec<DirEntry> = fs::read_dir(path)
        .with_context(|| format!("Cannot open {path}"))?
        .flatten()
        .filter_map(|entry| {
            let link_meta = entry.metadata().ok()?;
            let is_symlink = entry.file_type().map(|t| t.is_symlink()).unwrap_or(false);
            let meta = if is_symlink { fs::metadata(entry.path()).unwrap_or(link_meta) } else { link_meta };
            let name = entry.file_name().to_string_lossy().to_string();
            Some(DirEntry {
                hidden: is_hidden(&name, &meta),
                path: entry.path().to_string_lossy().to_string(),
                is_dir: meta.is_dir(),
                is_symlink,
                size: if meta.is_dir() { 0 } else { meta.len() },
                modified_ms: modified_ms(&meta),
                name,
            })
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

pub fn read_file(path: &str) -> anyhow::Result<FileContent> {
    let meta = fs::metadata(path).with_context(|| format!("Cannot open {path}"))?;
    let size = meta.len();
    if size > MAX_TEXT_BYTES {
        return Ok(FileContent::TooLarge { size });
    }
    let mut bytes = Vec::with_capacity(size as usize);
    fs::File::open(path)?.read_to_end(&mut bytes)?;
    let sniff = &bytes[..bytes.len().min(SNIFF_BYTES)];
    if sniff.contains(&0) {
        return Ok(FileContent::Binary { size });
    }
    let text = match String::from_utf8(bytes) {
        Ok(text) => text,
        Err(err) => String::from_utf8_lossy(err.as_bytes()).into_owned(),
    };
    Ok(FileContent::Text { text: text.strip_prefix('\u{FEFF}').map(str::to_string).unwrap_or(text), size })
}

pub fn write_file(path: &str, contents: &str) -> anyhow::Result<()> {
    let target = Path::new(path);
    anyhow::ensure!(target.is_file(), "Only existing files can be saved: {path}");
    let tmp = target.with_extension(format!(
        "{}.claude-deck-tmp",
        target.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default()
    ));
    fs::write(&tmp, contents)?;
    fs::rename(&tmp, target).or_else(|_| {
        let _ = fs::remove_file(&tmp);
        fs::write(target, contents)
    })?;
    Ok(())
}

pub fn list_files(root: &str) -> Vec<String> {
    let root_path = PathBuf::from(root);
    ignore::WalkBuilder::new(&root_path)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .require_git(false)
        .filter_entry(|e| !matches!(e.file_name().to_str(), Some(".git" | "node_modules" | "target")))
        .build()
        .flatten()
        .filter(|e| e.file_type().is_some_and(|t| t.is_file()))
        .filter_map(|e| e.path().strip_prefix(&root_path).ok().map(|p| p.to_string_lossy().to_string()))
        .take(QUICK_OPEN_LIMIT)
        .collect()
}

pub fn open_in_editor(path: &str) -> anyhow::Result<()> {
    let code = which::which("code").context("VS Code (`code`) is not on PATH")?;
    let mut cmd = std::process::Command::new(code);
    cmd.arg(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()?;
    Ok(())
}
