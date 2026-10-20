use std::{
    fs,
    io::{self, Read, Seek, Write},
    path::{Path, PathBuf},
};

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::{
    util::{guarded, hidden, mtime_ms, path_mtime_ms},
    wsl,
};

const MAX_TEXT_BYTES: u64 = 8 * 1024 * 1024;
const SNIFF_BYTES: usize = 8 * 1024;
const QUICK_OPEN_LIMIT: usize = 60_000;
const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";
const UTF16LE_BOM: &[u8] = b"\xFF\xFE";
const UTF16BE_BOM: &[u8] = b"\xFE\xFF";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
    pub hidden: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Encoding {
    Utf8,
    Utf16le,
    Utf16be,
    Lossy,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FileContent {
    #[serde(rename_all = "camelCase")]
    Text { text: String, size: u64, modified_ms: u64, encoding: Encoding },
    Binary { size: u64 },
    TooLarge { size: u64 },
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WriteOutcome {
    #[serde(rename_all = "camelCase")]
    Saved { modified_ms: u64 },
    #[serde(rename_all = "camelCase")]
    Conflict { modified_ms: u64 },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathStat {
    pub kind: &'static str,
}

fn is_hidden(name: &str, meta: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    name.starts_with('.') || meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0
}

pub fn list_dir(path: &str) -> anyhow::Result<Vec<DirEntry>> {
    guarded(Path::new(path))?;
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
                name,
            })
        })
        .collect();
    entries.sort_by_cached_key(|e| (!e.is_dir, e.name.to_lowercase()));
    Ok(entries)
}

fn decode_utf16(body: &[u8], unit: fn([u8; 2]) -> u16, encoding: Encoding) -> (String, Encoding) {
    let mut lossy = !body.len().is_multiple_of(2);
    let text = char::decode_utf16(body.as_chunks::<2>().0.iter().map(|c| unit(*c)))
        .map(|c| {
            c.unwrap_or_else(|_| {
                lossy = true;
                char::REPLACEMENT_CHARACTER
            })
        })
        .collect();
    (text, if lossy { Encoding::Lossy } else { encoding })
}

pub(crate) fn looks_binary(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(SNIFF_BYTES)].contains(&0)
}

fn decode(bytes: &[u8]) -> Option<(String, Encoding)> {
    if let Some(body) = bytes.strip_prefix(UTF16LE_BOM) {
        return Some(decode_utf16(body, u16::from_le_bytes, Encoding::Utf16le));
    }
    if let Some(body) = bytes.strip_prefix(UTF16BE_BOM) {
        return Some(decode_utf16(body, u16::from_be_bytes, Encoding::Utf16be));
    }
    if looks_binary(bytes) {
        return None;
    }
    let body = bytes.strip_prefix(UTF8_BOM).unwrap_or(bytes);
    Some(match std::str::from_utf8(body) {
        Ok(text) => (text.to_string(), Encoding::Utf8),
        Err(_) => (String::from_utf8_lossy(body).into_owned(), Encoding::Lossy),
    })
}

fn encode(text: &str, encoding: Encoding, utf8_bom: bool) -> anyhow::Result<Vec<u8>> {
    Ok(match encoding {
        Encoding::Utf8 => [if utf8_bom { UTF8_BOM } else { b"" }, text.as_bytes()].concat(),
        Encoding::Utf16le => UTF16LE_BOM.iter().copied().chain(text.encode_utf16().flat_map(u16::to_le_bytes)).collect(),
        Encoding::Utf16be => UTF16BE_BOM.iter().copied().chain(text.encode_utf16().flat_map(u16::to_be_bytes)).collect(),
        Encoding::Lossy => anyhow::bail!("This file isn't valid text in a known encoding, so it can only be viewed"),
    })
}

pub fn read_file(path: &str) -> anyhow::Result<FileContent> {
    let target = guarded(Path::new(path))?;
    let meta = fs::metadata(&target).with_context(|| format!("Cannot open {path}"))?;
    let size = meta.len();
    if size > MAX_TEXT_BYTES {
        return Ok(FileContent::TooLarge { size });
    }
    let mut bytes = Vec::with_capacity(size as usize);
    fs::File::open(&target)?.take(MAX_TEXT_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Ok(FileContent::TooLarge { size: bytes.len() as u64 });
    }
    Ok(match decode(&bytes) {
        Some((text, encoding)) => FileContent::Text { text, size, modified_ms: mtime_ms(&meta), encoding },
        None => FileContent::Binary { size },
    })
}

fn starts_with_utf8_bom(path: &Path) -> bool {
    let mut head = [0u8; 3];
    fs::File::open(path).and_then(|mut f| f.read_exact(&mut head)).is_ok() && head == UTF8_BOM
}

fn overwrite(target: &Path, data: &[u8]) -> io::Result<()> {
    let mut file = fs::OpenOptions::new().write(true).truncate(true).open(target)?;
    file.write_all(data)?;
    file.flush()
}

fn replace_atomically(target: &Path, data: &[u8]) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_IGNORE_MERGE_ERRORS};
    let name = target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = target.with_file_name(format!(".{name}.agent-deck-tmp"));
    fs::write(&tmp, data)?;
    let wide = |p: &Path| p.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let (target_w, tmp_w) = (wide(target), wide(&tmp));
    let replaced = unsafe {
        ReplaceFileW(
            target_w.as_ptr(),
            tmp_w.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_IGNORE_MERGE_ERRORS,
            std::ptr::null(),
            std::ptr::null(),
        )
    } != 0;
    if replaced {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    let _ = fs::remove_file(&tmp);
    Err(error)
}

fn save_bytes(target: &Path, data: &[u8]) -> io::Result<()> {
    if wsl::parse_host_path(&target.to_string_lossy()).is_some() {
        return overwrite(target, data);
    }
    replace_atomically(target, data).or_else(|_| overwrite(target, data))
}

pub fn write_file(
    path: &str,
    contents: &str,
    encoding: Option<Encoding>,
    expected_modified_ms: Option<u64>,
) -> anyhow::Result<WriteOutcome> {
    let target = guarded(Path::new(path))?;
    let meta = fs::metadata(&target).with_context(|| format!("Only existing files can be saved: {path}"))?;
    anyhow::ensure!(meta.is_file(), "Only existing files can be saved: {path}");
    let current = mtime_ms(&meta);
    if expected_modified_ms.is_some_and(|expected| expected != current) {
        return Ok(WriteOutcome::Conflict { modified_ms: current });
    }
    let encoding = encoding.unwrap_or(Encoding::Utf8);
    let data = encode(contents, encoding, encoding == Encoding::Utf8 && starts_with_utf8_bom(&target))?;
    save_bytes(&target, &data).with_context(|| format!("Couldn't save {path}"))?;
    Ok(WriteOutcome::Saved { modified_ms: path_mtime_ms(&target) })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTail {
    pub text: String,
    pub truncated: bool,
}

pub fn read_tail(path: &str, max_bytes: u64) -> anyhow::Result<FileTail> {
    let target = guarded(Path::new(path))?;
    let mut file = fs::File::open(&target).with_context(|| format!("Cannot open {path}"))?;
    let size = file.metadata()?.len();
    let start = size.saturating_sub(max_bytes);
    file.seek(io::SeekFrom::Start(start))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if start > 0 {
        if let Some(newline) = text.find('\n') {
            text.drain(..=newline);
        }
    }
    Ok(FileTail { text, truncated: start > 0 })
}

pub fn stat_path(path: &str) -> anyhow::Result<Option<PathStat>> {
    let target = guarded(Path::new(path))?;
    match fs::metadata(&target) {
        Ok(meta) => Ok(Some(PathStat { kind: if meta.is_dir() { "dir" } else { "file" } })),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error).with_context(|| format!("Cannot open {path}")),
    }
}

pub fn list_files(root: &str) -> anyhow::Result<Vec<String>> {
    guarded(Path::new(root))?;
    let root_path = PathBuf::from(root);
    Ok(ignore::WalkBuilder::new(&root_path)
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
        .collect())
}

fn existing(path: &str) -> anyhow::Result<PathBuf> {
    let target = guarded(Path::new(path))?;
    anyhow::ensure!(!path.starts_with('-') && target.exists(), "Can't open {path}");
    Ok(target)
}

pub fn open_in_editor(path: &str) -> anyhow::Result<()> {
    let target = existing(path)?;
    let code = which::which("code").context("VS Code (`code`) is not on PATH")?;
    let mut command = std::process::Command::new(code);
    match wsl::parse_host_path(path) {
        Some((distro, linux)) => command.args(["--remote", &format!("wsl+{distro}"), "--", &linux]),
        None => command.arg("--").arg(&target),
    };
    hidden(&mut command).spawn()?;
    Ok(())
}

const BLOCKED_EXTENSIONS: &[&str] = &[
    "ade", "adp", "app", "appinstaller", "application", "appref-ms", "appx", "appxbundle", "bat", "chm", "cmd", "com",
    "cpl", "crt", "diagcab", "diagpkg", "exe", "gadget", "hta", "img", "inf", "ins", "iso", "isp", "jar", "jnlp", "js",
    "jse", "library-ms", "lnk", "mde", "msc", "msh", "msh1", "msh2", "mshxml", "msi", "msix", "msixbundle", "msp", "mst",
    "pif", "ps1", "ps1xml", "ps2", "ps2xml", "psc1", "psc2", "psd1", "psm1", "py", "pyc", "pyo", "pyw", "pyz", "reg",
    "scf", "scr", "sct", "search-ms", "searchconnector-ms", "settingcontent-ms", "shb", "shs", "theme", "themepack",
    "url", "vb", "vbe", "vbs", "vhd", "vhdx", "ws", "wsc", "wsf", "wsh", "xbap", "xll",
];

fn is_blocked_extension(path: &Path) -> bool {
    let Some(extension) = path.extension().map(|e| e.to_string_lossy().to_lowercase()) else { return false };
    let from_env = std::env::var("PATHEXT").unwrap_or_default();
    BLOCKED_EXTENSIONS.contains(&extension.as_str())
        || from_env.split(';').any(|e| e.trim_start_matches('.').eq_ignore_ascii_case(&extension))
}

pub fn open_path(path: &str) -> anyhow::Result<()> {
    let target = existing(path)?;
    anyhow::ensure!(
        target.is_dir() || !(is_blocked_extension(&target) || is_blocked_extension(Path::new(path))),
        "Agent Deck doesn't launch programs or scripts. Use Reveal in File Explorer instead."
    );
    Ok(tauri_plugin_opener::open_path(path, None::<&str>)?)
}

pub fn reveal_path(path: &str) -> anyhow::Result<()> {
    existing(path)?;
    Ok(tauri_plugin_opener::reveal_item_in_dir(path)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_text_encodings() {
        assert_eq!(decode(b"hi \xE2\x9C\x93"), Some(("hi ✓".into(), Encoding::Utf8)));
        assert_eq!(decode(b"\xEF\xBB\xBFbom"), Some(("bom".into(), Encoding::Utf8)));
        assert_eq!(decode(b"\xFF\xFEh\0i\0"), Some(("hi".into(), Encoding::Utf16le)));
        assert_eq!(decode(b"\xFE\xFF\0h\0i"), Some(("hi".into(), Encoding::Utf16be)));
        assert_eq!(decode(b"caf\xE9"), Some(("caf\u{FFFD}".into(), Encoding::Lossy)));
        assert_eq!(decode(b"\xFF\xFE\x00\xD8"), Some(("\u{FFFD}".into(), Encoding::Lossy)));
        assert_eq!(decode(b"a\0b"), None);
    }

    #[test]
    fn encodes_back_to_the_same_bytes() {
        for bytes in [&b"\xFF\xFEh\0i\0"[..], b"\xFE\xFF\0h\0i", b"plain"] {
            let (text, encoding) = decode(bytes).unwrap();
            assert_eq!(encode(&text, encoding, false).unwrap(), bytes);
        }
        assert_eq!(encode("x", Encoding::Utf8, true).unwrap(), b"\xEF\xBB\xBFx");
        assert!(encode("x", Encoding::Lossy, false).is_err());
    }

    #[test]
    fn saves_with_conflict_detection() {
        let dir = std::env::temp_dir().join(format!("deck-fsx-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.txt");
        fs::write(&file, "\u{feff}old").unwrap();
        let path = file.to_string_lossy().to_string();
        let FileContent::Text { text, modified_ms, encoding, .. } = read_file(&path).unwrap() else { panic!() };
        assert_eq!((text.as_str(), encoding), ("old", Encoding::Utf8));
        assert_eq!(write_file(&path, "stale", None, Some(modified_ms + 5)).unwrap(), WriteOutcome::Conflict { modified_ms });
        assert!(matches!(write_file(&path, "new", Some(encoding), Some(modified_ms)).unwrap(), WriteOutcome::Saved { .. }));
        assert_eq!(fs::read(&file).unwrap(), b"\xEF\xBB\xBFnew");
        assert!(write_file(&dir.join("missing.txt").to_string_lossy(), "x", None, None).is_err());
        assert!(stat_path(&dir.join("missing.txt").to_string_lossy()).unwrap().is_none());
        assert_eq!(stat_path(&path).unwrap().unwrap().kind, "file");
        assert_eq!(stat_path(&dir.to_string_lossy()).unwrap().unwrap().kind, "dir");
        assert!(stat_path(r"\\attacker\share\x").is_err());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    #[ignore]
    fn saves_inside_wsl_without_losing_the_mode() {
        let sh = |script: &str| {
            let out = std::process::Command::new("wsl.exe").args(["-d", "Debian", "-e", "sh", "-c", script]).output().unwrap();
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        sh("rm -rf /tmp/deck-save-test && mkdir -p /tmp/deck-save-test && printf 'echo old\\n' > /tmp/deck-save-test/run.sh && chmod 755 /tmp/deck-save-test/run.sh");
        let path = r"\\wsl.localhost\Debian\tmp\deck-save-test\run.sh";
        let FileContent::Text { modified_ms, encoding, .. } = read_file(path).unwrap() else { panic!() };
        assert!(matches!(write_file(path, "echo new\n", Some(encoding), Some(modified_ms)).unwrap(), WriteOutcome::Saved { .. }));
        assert_eq!(sh("stat -c %a /tmp/deck-save-test/run.sh"), "755");
        assert_eq!(sh("cat /tmp/deck-save-test/run.sh"), "echo new");
        assert!(matches!(write_file(path, "stale\n", Some(encoding), Some(modified_ms.saturating_sub(5000))).unwrap(), WriteOutcome::Conflict { .. }));
        sh("rm -rf /tmp/deck-save-test");
    }

    #[test]
    fn blocks_programs_case_insensitively() {
        assert!(is_blocked_extension(Path::new(r"C:\x\Setup.EXE")));
        assert!(is_blocked_extension(Path::new(r"C:\x\run.Cmd")));
        assert!(is_blocked_extension(Path::new(r"C:\x\link.url")));
        assert!(!is_blocked_extension(Path::new(r"C:\x\report.pdf")));
        assert!(!is_blocked_extension(Path::new(r"C:\x\README")));
    }
}
