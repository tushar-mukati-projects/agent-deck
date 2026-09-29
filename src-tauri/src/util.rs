use std::{
    fs,
    io::{BufRead, BufReader, Read, Write},
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

pub fn lenient<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Ok(match serde::Deserialize::deserialize(deserializer)? {
        serde_json::Value::String(text) => Some(text),
        _ => None,
    })
}

pub fn lenient_bool<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    Ok(matches!(serde::Deserialize::deserialize(deserializer)?, serde_json::Value::Bool(true)))
}

pub fn jsonl_lines(file: fs::File) -> impl Iterator<Item = String> {
    BufReader::with_capacity(256 * 1024, file)
        .split(b'\n')
        .map_while(Result::ok)
        .filter_map(|line| String::from_utf8(line).ok())
}

pub fn has_parent_components(path: &Path) -> bool {
    path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir))
}

pub fn canonical(path: &Path) -> anyhow::Result<PathBuf> {
    anyhow::ensure!(!has_parent_components(path), "Relative path segments are not allowed");
    check_remote(path)?;
    dunce::canonicalize(path).with_context(|| format!("Path not found: {}", path.display()))
}

pub fn is_session_id(value: &str) -> bool {
    value.len() == 36
        && value.chars().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        })
}

const SENSITIVE_DIRS: &[&str] = &[".ssh", ".aws", ".gnupg", ".kube", ".azure", ".docker", ".password-store"];
const SENSITIVE_FILES: &[&str] = &[".git-credentials", ".netrc", "_netrc", ".pgpass"];
const SENSITIVE_RUNS: &[&[&str]] = &[
    &[".claude", ".credentials.json"],
    &[".codex", "auth.json"],
    &[".config", "gh", "hosts.yml"],
    &[".config", "gcloud"],
];

pub fn is_sensitive(path: &Path) -> bool {
    let parts: Vec<String> = path
        .components()
        .filter_map(|c| match c {
            Component::Normal(part) => Some(part.to_string_lossy().to_lowercase()),
            _ => None,
        })
        .collect();
    parts.iter().any(|part| SENSITIVE_DIRS.contains(&part.as_str()))
        || parts.last().is_some_and(|name| SENSITIVE_FILES.contains(&name.as_str()))
        || SENSITIVE_RUNS.iter().any(|run| parts.windows(run.len()).any(|w| w.iter().zip(run.iter()).all(|(a, b)| a == b)))
}

fn unc_host(path: &str) -> Option<String> {
    let text = path.replace('/', "\\");
    let rest = if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        rest
    } else if let Some(rest) = text.strip_prefix(r"\\?\").or_else(|| text.strip_prefix(r"\\.\")) {
        let local = rest.as_bytes().first().is_some_and(u8::is_ascii_alphabetic) && rest.get(1..3) == Some(":\\");
        return if local { None } else { Some(String::new()) };
    } else {
        text.strip_prefix(r"\\")?
    };
    Some(rest.split('\\').next().unwrap_or_default().to_lowercase())
}

pub fn is_wsl_host(host: &str) -> bool {
    host == "wsl.localhost" || host == "wsl$"
}

pub fn check_remote(path: &Path) -> anyhow::Result<()> {
    match unc_host(&path.to_string_lossy()) {
        Some(host) if !is_wsl_host(&host) => anyhow::bail!("Claude Deck only opens network paths inside WSL"),
        _ => Ok(()),
    }
}

fn simplify_unc(path: &Path) -> PathBuf {
    match path.to_string_lossy().strip_prefix(r"\\?\UNC\") {
        Some(rest) => PathBuf::from(format!(r"\\{rest}")),
        None => path.to_path_buf(),
    }
}

pub fn guarded(path: &Path) -> anyhow::Result<PathBuf> {
    anyhow::ensure!(!has_parent_components(path), "Relative path segments are not allowed");
    check_remote(path)?;
    anyhow::ensure!(path.is_absolute(), "Only absolute paths can be opened: {}", path.display());
    let resolved = dunce::canonicalize(path)
        .ok()
        .or_else(|| {
            let parent = dunce::canonicalize(path.parent()?).ok()?;
            Some(parent.join(path.file_name()?))
        })
        .map(|p| simplify_unc(&p))
        .unwrap_or_else(|| path.to_path_buf());
    check_remote(&resolved)?;
    anyhow::ensure!(
        !is_sensitive(path) && !is_sensitive(&resolved),
        "Claude Deck doesn't open files in credential folders"
    );
    Ok(resolved)
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
        for path in [
            r"C:\Users\me\.ssh\id_ed25519",
            r"C:\Users\me\.claude\.credentials.json",
            r"C:\Users\me\.codex\auth.json",
            r"C:\Users\me\.git-credentials",
            r"C:\Users\me\.config\gh\hosts.yml",
            r"\\wsl.localhost\Debian\home\me\.ssh\config",
            r"\\wsl.localhost\Debian\home\me\.pgpass",
            r"\\wsl.localhost\Debian\home\me\.docker\config.json",
        ] {
            assert!(is_sensitive(Path::new(path)), "{path}");
        }
        for path in [
            r"C:\Users\me\my-files\dev\app\src\main.ts",
            r"C:\Users\me\.claude\settings.json",
            r"C:\Users\me\.codex\AGENTS.md",
        ] {
            assert!(!is_sensitive(Path::new(path)), "{path}");
        }
    }

    #[test]
    fn rejects_parent_segments() {
        assert!(has_parent_components(Path::new(r"C:\a\..\b")));
        assert!(!has_parent_components(Path::new(r"C:\a\b")));
    }

    #[test]
    fn allows_only_local_and_wsl_paths() {
        for path in [r"C:\Users\me\a.md", r"\\wsl.localhost\Debian\home", r"\\WSL$\Ubuntu\x", r"\\?\C:\x", "//wsl.localhost/Debian/x"] {
            assert!(check_remote(Path::new(path)).is_ok(), "{path}");
        }
        for path in [r"\\attacker\share\a.png", r"\\?\UNC\evil\s\x", r"\\.\pipe\x", "//evil/share/x", r"\\?\GLOBALROOT\x"] {
            assert!(check_remote(Path::new(path)).is_err(), "{path}");
        }
    }

    #[test]
    #[ignore]
    fn probe_wsl_canonical_form() {
        let resolved = guarded(Path::new(r"\\wsl.localhost\Debian\etc\hostname")).unwrap();
        println!("resolved={} host={:?}", resolved.display(), crate::wsl::parse_host_path(&resolved.to_string_lossy()));
        assert!(crate::wsl::parse_host_path(&resolved.to_string_lossy()).is_some());
    }

    #[test]
    fn guard_resolves_before_checking() {
        assert!(guarded(Path::new(r"\\attacker\share\a.png")).is_err());
        assert!(guarded(Path::new("relative.txt")).is_err());
        assert!(guarded(Path::new(r"C:\Users\me\.ssh\missing")).is_err());
        let dir = std::env::temp_dir();
        assert_eq!(guarded(&dir.join("deck-missing-file.txt")).unwrap().file_name().unwrap(), "deck-missing-file.txt");
    }
}
