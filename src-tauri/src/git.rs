use std::{path::Path, process::Command, time::Duration};

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::util::{check_remote, run_with_timeout};

const GIT_TIMEOUT: Duration = Duration::from_secs(15);
const SAFE_CONFIG: &[&str] = &["-c", "core.fsmonitor=false", "-c", "core.hooksPath=NUL", "-c", "core.quotePath=false"];

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub path: String,
    pub code: String,
}

fn git(dir: &str, args: &[&str]) -> anyhow::Result<Vec<u8>> {
    let output = run_with_timeout(
        Command::new("git").args(SAFE_CONFIG).arg("-C").arg(dir).args(args),
        None,
        GIT_TIMEOUT,
    )
    .context("git is not available")?;
    anyhow::ensure!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr).trim());
    Ok(output.stdout)
}

fn parse_porcelain(output: &[u8], to_path: impl Fn(&str) -> String) -> Vec<GitChange> {
    let mut changes = Vec::new();
    let mut entries = output.split(|b| *b == 0).filter(|e| !e.is_empty());
    while let Some(entry) = entries.next() {
        if entry.len() < 4 {
            continue;
        }
        if entry[..2].iter().any(|c| matches!(c, b'R' | b'C')) {
            entries.next();
        }
        let code = String::from_utf8_lossy(&entry[..2]).trim().to_string();
        let path = String::from_utf8_lossy(&entry[3..]);
        changes.push(GitChange { path: to_path(&path), code: if code.is_empty() { "M".into() } else { code } });
    }
    changes
}

pub fn status(root: &str) -> anyhow::Result<Vec<GitChange>> {
    check_remote(Path::new(root))?;
    let top = String::from_utf8(git(root, &["rev-parse", "--show-toplevel"])?)?.trim().replace('/', "\\");
    let output = git(root, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    Ok(parse_porcelain(&output, |rel| format!("{}\\{}", top, rel.replace('/', "\\"))))
}

pub fn head_file(path: &str) -> anyhow::Result<String> {
    let file = Path::new(path);
    check_remote(file)?;
    let dir = file.parent().context("invalid path")?.to_string_lossy().to_string();
    let name = file.file_name().context("invalid path")?.to_string_lossy().to_string();
    let bytes = git(&dir, &["show", &format!("HEAD:./{name}")])?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_porcelain_with_renames() {
        let out = b" M src/a.ts\0R  new.ts\0old.ts\0?? notes.md\0";
        let changes = parse_porcelain(out, |p| p.to_string());
        let summary: Vec<_> = changes.iter().map(|c| (c.code.as_str(), c.path.as_str())).collect();
        assert_eq!(summary, vec![("M", "src/a.ts"), ("R", "new.ts"), ("??", "notes.md")]);
    }

    #[test]
    fn skips_rename_sources_in_either_column_and_handles_unicode() {
        let out = " R new.txt\0old.txt\0M  aé.txt\0?? ü\0".as_bytes();
        let changes = parse_porcelain(out, |p| p.to_string());
        let summary: Vec<_> = changes.iter().map(|c| (c.code.as_str(), c.path.as_str())).collect();
        assert_eq!(summary, vec![("R", "new.txt"), ("M", "aé.txt"), ("??", "ü")]);
    }
}
