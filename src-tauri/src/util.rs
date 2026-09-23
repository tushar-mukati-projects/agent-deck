use std::{
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, UNIX_EPOCH},
};

use anyhow::{anyhow, Context};
use wait_timeout::ChildExt;

pub fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn path_mtime_ms(path: &Path) -> u64 {
    fs::metadata(path).map(|m| mtime_ms(&m)).unwrap_or(0)
}

pub fn run_with_timeout(command: &mut Command, input: Option<&[u8]>, timeout: Duration) -> anyhow::Result<Output> {
    let mut child = hidden(command)
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("Couldn't start process")?;

    let stdin = child.stdin.take();
    let payload = input.map(<[u8]>::to_vec);
    let writer = thread::spawn(move || {
        if let (Some(mut stdin), Some(payload)) = (stdin, payload) {
            let _ = stdin.write_all(&payload);
        }
    });
    let mut stdout = child.stdout.take().context("missing stdout")?;
    let mut stderr = child.stderr.take().context("missing stderr")?;
    let out_reader = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });
    let err_reader = thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr.read_to_end(&mut buf);
        buf
    });

    let status = match child.wait_timeout(timeout)? {
        Some(status) => status,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(anyhow!("Timed out after {}s", timeout.as_secs()));
        }
    };
    let _ = writer.join();
    Ok(Output {
        status,
        stdout: out_reader.join().unwrap_or_default(),
        stderr: err_reader.join().unwrap_or_default(),
    })
}

pub fn has_parent_components(path: &Path) -> bool {
    path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir))
}

pub fn canonical(path: &Path) -> anyhow::Result<PathBuf> {
    anyhow::ensure!(!has_parent_components(path), "Relative path segments are not allowed");
    dunce::canonicalize(path).with_context(|| format!("Path not found: {}", path.display()))
}

pub fn is_session_id(value: &str) -> bool {
    value.len() == 36
        && value.chars().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

const SENSITIVE_DIRS: &[&str] = &[".ssh", ".aws", ".gnupg", ".kube", ".azure", ".docker"];

pub fn is_sensitive(path: &Path) -> bool {
    let lower: Vec<String> = path
        .components()
        .filter_map(|c| match c {
            Component::Normal(part) => Some(part.to_string_lossy().to_lowercase()),
            _ => None,
        })
        .collect();
    lower.iter().any(|part| SENSITIVE_DIRS.contains(&part.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_session_ids() {
        assert!(is_session_id("11111111-2222-4333-8444-555555555555"));
        assert!(!is_session_id("../../etc"));
        assert!(!is_session_id(""));
    }

    #[test]
    fn flags_sensitive_paths() {
        assert!(is_sensitive(Path::new(r"C:\Users\me\.ssh\id_ed25519")));
        assert!(!is_sensitive(Path::new(r"C:\Users\me\my-files\dev\app\src\main.ts")));
    }

    #[test]
    fn rejects_parent_segments() {
        assert!(has_parent_components(Path::new(r"C:\a\..\b")));
        assert!(!has_parent_components(Path::new(r"C:\a\b")));
    }
}
