use std::{
    collections::HashMap,
    process::Command,
    sync::{Arc, LazyLock},
    thread,
    time::Duration,
};

use anyhow::{anyhow, Context};
use parking_lot::Mutex;
use serde::{de::DeserializeOwned, Deserialize};

use super::{CACHE, SCRIPT};
use crate::util::{run_with_timeout, sh_quote, wslenv_with};

const BOOTSTRAP: &str = "import sys,base64;exec(base64.b64decode(sys.stdin.readline()))";
const AGENT_TIMEOUT: Duration = Duration::from_secs(30);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(20);
const FORWARDED_VARS: [&str; 2] = ["CLAUDE_CONFIG_DIR", "CODEX_HOME"];
const ENCODING_SAMPLE_BYTES: usize = 256;

type LoginEnv = Arc<HashMap<String, String>>;
type LoginSlot = Arc<Mutex<Option<LoginEnv>>>;
static LOGIN_ENV: LazyLock<Mutex<HashMap<String, LoginSlot>>> = LazyLock::new(Mutex::default);

#[derive(Deserialize)]
struct ErrorReply {
    error: Option<String>,
}

pub fn decode_output(bytes: &[u8]) -> String {
    let sample = &bytes[..bytes.len().min(ENCODING_SAMPLE_BYTES)];
    let odd_nuls = sample.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
    if sample.len() >= 2 && odd_nuls * 4 >= sample.len() {
        let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        String::from_utf16_lossy(&units).trim_start_matches('\u{feff}').to_string()
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

pub(super) fn agent_command(distro: &str, args: &[&str]) -> Command {
    let mut command = Command::new("wsl.exe");
    command.args(["-d", distro, "-e", "python3", "-c", BOOTSTRAP]).args(args);
    command
}

fn forward_login_vars(command: &mut Command, distro: &str) {
    let Some(env) = known_login_env(distro) else { return };
    let forwarded: Vec<&str> = FORWARDED_VARS.iter().copied().filter(|key| env.get(*key).is_some_and(|v| !v.is_empty())).collect();
    if forwarded.is_empty() {
        return;
    }
    for key in &forwarded {
        command.env(key, &env[*key]);
    }
    command.env("WSLENV", wslenv_with(forwarded.iter().map(|k| format!("{k}/u"))));
}

fn run_agent_raw(mut command: Command, distro: &str, input: Option<String>, timeout: Duration) -> anyhow::Result<Vec<u8>> {
    let payload = format!("{}\n{}", *SCRIPT, input.unwrap_or_default());
    let output = run_with_timeout(&mut command, Some(payload.as_bytes()), timeout).with_context(|| format!("WSL {distro} didn't respond"))?;
    if let Ok(reply) = serde_json::from_slice::<ErrorReply>(&output.stdout) {
        if let Some(error) = reply.error {
            return Err(anyhow!("WSL {distro}: {error}"));
        }
        return Ok(output.stdout);
    }
    let stderr = decode_output(&output.stderr);
    Err(anyhow!("WSL {distro}: {}", stderr.trim().lines().last().unwrap_or("agent failed (is python3 installed?)")))
}

pub(super) fn run_agent_with<T: DeserializeOwned>(distro: &str, args: &[&str], input: Option<String>, timeout: Duration) -> anyhow::Result<T> {
    let mut command = agent_command(distro, args);
    forward_login_vars(&mut command, distro);
    let bytes = run_agent_raw(command, distro, input, timeout)?;
    serde_json::from_slice(&bytes).with_context(|| format!("WSL {distro} sent an unexpected reply"))
}

pub(super) fn run_agent<T: DeserializeOwned>(distro: &str, args: &[&str], input: Option<String>) -> anyhow::Result<T> {
    run_agent_with(distro, args, input, AGENT_TIMEOUT)
}

fn login_slot(distro: &str) -> LoginSlot {
    LOGIN_ENV.lock().entry(distro.to_string()).or_default().clone()
}

pub(super) fn known_login_env(distro: &str) -> Option<LoginEnv> {
    let slot = login_slot(distro);
    let value = slot.try_lock()?;
    if let Some(env) = value.as_ref() {
        return Some(env.clone());
    }
    drop(value);
    let distro = distro.to_string();
    thread::spawn(move || login_env(&distro));
    None
}

fn login_env(distro: &str) -> Option<LoginEnv> {
    let slot = login_slot(distro);
    let mut value = slot.lock();
    if let Some(env) = value.as_ref() {
        return Some(env.clone());
    }
    #[derive(Deserialize)]
    struct Reply {
        shell: String,
        env: HashMap<String, String>,
    }
    let reply = run_agent_raw(agent_command(distro, &["loginenv"]), distro, None, LOGIN_TIMEOUT)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Reply>(&bytes).ok())?;
    CACHE.lock().distros.entry(distro.to_string()).or_default().shell = Some(reply.shell);
    Some(value.insert(Arc::new(reply.env)).clone())
}

pub fn login_var(distro: &str, name: &str) -> Option<String> {
    login_env(distro)?.get(name).cloned()
}

pub fn env_var(distro: Option<&str>, name: &str) -> Option<String> {
    match distro {
        Some(distro) => login_var(distro, name),
        None => std::env::var(name).ok(),
    }
}

pub fn login_command(distro: &str, linux_cwd: &str, program: &str, args: &[impl AsRef<str>]) -> Command {
    let script = std::iter::once(program).chain(args.iter().map(AsRef::as_ref)).map(sh_quote).collect::<Vec<_>>().join(" ");
    let mut command = Command::new("wsl.exe");
    command.args(["-d", distro, "--cd", linux_cwd, "-e", &login_shell(distro), "-lic"]).arg(format!("exec {script}"));
    command
}

fn login_shell(distro: &str) -> String {
    if let Some(shell) = CACHE.lock().distros.get(distro).and_then(|d| d.shell.clone()) {
        return shell;
    }
    login_env(distro);
    CACHE.lock().distros.get(distro).and_then(|d| d.shell.clone()).unwrap_or_else(|| "bash".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_both_wsl_output_encodings() {
        let utf16: Vec<u8> = "\u{feff}Debian\r\nUbuntu\r\n".encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_output(&utf16), "Debian\r\nUbuntu\r\n");
        assert_eq!(decode_output("Debian\nUbuntu\n".as_bytes()), "Debian\nUbuntu\n");
        assert_eq!(decode_output(b""), "");
    }
}
