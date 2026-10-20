use std::path::{Path, PathBuf};

use anyhow::Context;
use portable_pty::CommandBuilder;

use super::SpawnRequest;
use crate::util::wslenv_with;

const ALLOWED_PROGRAMS: &[&str] = &["claude", "codex", "pwsh", "powershell", "cmd", "wsl", "bash", "zsh", "fish", "nu", "sh"];

const SCRUBBED_ENV: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_MESSAGING_SOCKET",
    "CLAUDE_CODE_MESSAGING_TOKEN",
    "CLAUDE_CODE_SESSION_ATTENDED",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_PID",
    "NO_COLOR",
    "TERM_PROGRAM_VERSION",
];

const SCRUBBED_ENV_PREFIXES: &[&str] = &["WARP_", "WT_", "VSCODE_", "TERMINAL_EMULATOR"];

fn program_stem(program: &str) -> String {
    Path::new(program)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

pub fn resolve_program(program: &str) -> anyhow::Result<PathBuf> {
    anyhow::ensure!(
        ALLOWED_PROGRAMS.contains(&program_stem(program).as_str()),
        "`{program}` is not an allowed terminal program"
    );
    if let Ok(found) = which::which(program) {
        return Ok(found);
    }
    let home = dirs::home_dir().unwrap_or_default();
    let exe = format!("{program}.exe");
    [home.join(".local").join("bin").join(&exe), home.join(".claude").join("local").join(&exe)]
        .into_iter()
        .find(|p| p.is_file())
        .with_context(|| format!("`{program}` was not found on PATH"))
}

pub fn default_shell() -> String {
    ["pwsh.exe", "powershell.exe", "cmd.exe"].into_iter().find(|s| which::which(s).is_ok()).unwrap_or("cmd.exe").to_string()
}

fn is_agent_name(name: &str) -> bool {
    !name.is_empty() && name.chars().all(|c| c.is_alphanumeric() || matches!(c, '_' | ':' | '.' | '-'))
}

fn check_agent_names(args: &[String]) -> anyhow::Result<()> {
    for pair in args.windows(2).filter(|pair| pair[0] == "--agent") {
        anyhow::ensure!(is_agent_name(&pair[1]), "\"{}\" isn't a valid agent name", pair[1]);
    }
    Ok(())
}

fn msvc_quote(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '\x0b', '"']) {
        return arg.to_string();
    }
    let mut out = String::from('"');
    let mut backslashes = 0;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            _ => {
                out.push_str(&"\\".repeat(backslashes));
                out.push(c);
                backslashes = 0;
            }
        }
    }
    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

fn check_batch_arguments(program: &Path, args: &[String]) -> anyhow::Result<()> {
    let line = std::iter::once(program.to_string_lossy().to_string()).chain(args.iter().cloned()).map(|a| msvc_quote(&a)).collect::<Vec<_>>().join(" ");
    let mut quoted = false;
    for c in line.chars() {
        let unsafe_anywhere = matches!(c, '%' | '!' | '\r' | '\n');
        let unsafe_outside = matches!(c, '&' | '|' | '<' | '>' | '^' | '(' | ')');
        anyhow::ensure!(
            !unsafe_anywhere && (quoted || !unsafe_outside),
            "{} is a batch file, and one of its arguments contains characters cmd.exe would run as commands",
            program.display()
        );
        if c == '"' {
            quoted = !quoted;
        }
    }
    Ok(())
}

pub(super) fn build_command(req: &SpawnRequest) -> anyhow::Result<CommandBuilder> {
    check_agent_names(&req.args)?;
    let program = resolve_program(&req.program)?;
    if program.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat")) {
        check_batch_arguments(&program, &req.args)?;
    }
    let mut cmd = CommandBuilder::new(program);
    cmd.args(&req.args);
    cmd.cwd(&req.cwd);
    let inherited = std::env::vars_os()
        .filter_map(|(key, _)| key.into_string().ok())
        .filter(|key| SCRUBBED_ENV_PREFIXES.iter().any(|prefix| key.starts_with(prefix)));
    for key in SCRUBBED_ENV.iter().map(|k| k.to_string()).chain(inherited) {
        cmd.env_remove(key);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "agent-deck");
    if program_stem(&req.program) == "wsl" {
        cmd.env("WSLENV", wslenv_with(["COLORTERM".to_string(), "TERM_PROGRAM".to_string()]));
    }
    Ok(cmd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_only_terminal_programs() {
        assert!(ALLOWED_PROGRAMS.contains(&program_stem("C:\\Program Files\\PowerShell\\7\\pwsh.exe").as_str()));
        assert!(ALLOWED_PROGRAMS.contains(&program_stem("wsl.exe").as_str()));
        assert!(!ALLOWED_PROGRAMS.contains(&program_stem("calc.exe").as_str()));
    }

    #[test]
    fn validates_agent_names() {
        assert!(check_agent_names(&["--agent".into(), "plugin:code-reviewer.v2".into()]).is_ok());
        assert!(check_agent_names(&["--agent".into(), "x&calc".into()]).is_err());
        assert!(check_agent_names(&["--resume".into(), "a&b".into()]).is_ok());
    }

    #[test]
    fn guards_batch_file_arguments() {
        let shim = Path::new(r"C:\Users\me\AppData\Roaming\npm\claude.cmd");
        let ok = |args: &[&str]| check_batch_arguments(shim, &args.iter().map(|a| a.to_string()).collect::<Vec<_>>()).is_ok();
        assert!(ok(&["--resume", "11111111-2222-4333-8444-555555555555", "--settings", r#"{"theme":"dark"}"#]));
        assert!(ok(&["--append-system-prompt", "be brief & kind"]));
        assert!(!ok(&["x&calc"]));
        assert!(!ok(&[r#"a\"&calc"#]));
        assert!(!ok(&["%PATH%"]));
        assert!(!ok(&["line\nbreak"]));
        assert_eq!(msvc_quote(r#"{"a":"b"}"#), r#""{\"a\":\"b\"}""#);
        assert_eq!(msvc_quote(r"C:\dir with space\"), r#""C:\dir with space\\""#);
    }
}
