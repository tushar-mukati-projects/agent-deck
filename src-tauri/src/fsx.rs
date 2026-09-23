use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

use anyhow::Context;
use serde::Serialize;

use crate::util::{has_parent_components, hidden, is_sensitive, mtime_ms};

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
                modified_ms: mtime_ms(&meta),
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

const BOM: &[u8] = b"\xEF\xBB\xBF";

fn guard(path: &Path) -> anyhow::Result<()> {
    anyhow::ensure!(!has_parent_components(path), "Relative path segments are not allowed");
    anyhow::ensure!(!is_sensitive(path), "Claude Deck doesn't open files in credential folders");
    Ok(())
}

pub fn read_file(path: &str) -> anyhow::Result<FileContent> {
    let target = Path::new(path);
    guard(target)?;
    let size = fs::metadata(target).with_context(|| format!("Cannot open {path}"))?.len();
    if size > MAX_TEXT_BYTES {
        return Ok(FileContent::TooLarge { size });
    }
    let mut bytes = Vec::with_capacity(size as usize);
    fs::File::open(target)?.take(MAX_TEXT_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Ok(FileContent::TooLarge { size: bytes.len() as u64 });
    }
    if bytes[..bytes.len().min(SNIFF_BYTES)].contains(&0) {
        return Ok(FileContent::Binary { size });
    }
    let body = bytes.strip_prefix(BOM).unwrap_or(&bytes);
    Ok(FileContent::Text { text: String::from_utf8_lossy(body).into_owned(), size })
}

pub fn write_file(path: &str, contents: &str) -> anyhow::Result<()> {
    let requested = Path::new(path);
    guard(requested)?;
    anyhow::ensure!(requested.is_file(), "Only existing files can be saved: {path}");
    let target = dunce::canonicalize(requested)?;
    guard(&target)?;
    let mut head = [0u8; 3];
    let had_bom = fs::File::open(&target).and_then(|mut f| f.read_exact(&mut head)).is_ok() && head == BOM;
    let mut data = Vec::with_capacity(contents.len() + 3);
    if had_bom {
        data.extend_from_slice(BOM);
    }
    data.extend_from_slice(contents.as_bytes());
    let file_name = target.file_name().context("invalid file name")?.to_string_lossy().to_string();
    let tmp = target.with_file_name(format!(".{file_name}.claude-deck-tmp"));
    fs::write(&tmp, &data)?;
    if fs::rename(&tmp, &target).is_err() {
        let _ = fs::remove_file(&tmp);
        fs::write(&target, &data)?;
    }
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
    let target = Path::new(path);
    anyhow::ensure!(target.is_absolute() && target.exists() && !path.starts_with('-'), "Can't open {path}");
    let code = which::which("code").context("VS Code (`code`) is not on PATH")?;
    hidden(std::process::Command::new(code).arg("--").arg(target)).spawn()?;
    Ok(())
}
