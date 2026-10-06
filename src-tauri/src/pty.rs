use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{mpsc, Arc},
    thread,
};

use anyhow::{anyhow, Context};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

const REPLAY_LIMIT: usize = 2 * 1024 * 1024;
const LINE_SEARCH_LIMIT: usize = 64 * 1024;
const SENDER_BATCH_LIMIT: usize = 512 * 1024;

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

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyEvent {
    Data { data: String },
    Exit { code: Option<u32> },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnRequest {
    pub id: String,
    pub cwd: String,
    pub program: String,
    pub args: Vec<String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PtyInfo {
    pub id: String,
    pub pid: Option<u32>,
    pub exit_code: Option<u32>,
    pub exited: bool,
}

#[derive(Default)]
struct Output {
    replay: String,
    channel: Option<Channel<PtyEvent>>,
    exited: bool,
    exit_code: Option<u32>,
}

fn replay_cut(replay: &str) -> usize {
    let mut cut = replay.len() - REPLAY_LIMIT / 2;
    while !replay.is_char_boundary(cut) {
        cut += 1;
    }
    match replay[cut..].find('\n') {
        Some(offset) if offset < LINE_SEARCH_LIMIT => cut + offset + 1,
        _ => cut,
    }
}

impl Output {
    fn emit(&self, event: PtyEvent) {
        if let Some(channel) = &self.channel {
            let _ = channel.send(event);
        }
    }

    fn push(&mut self, data: String) {
        self.replay.push_str(&data);
        if self.replay.len() > REPLAY_LIMIT {
            let cut = replay_cut(&self.replay);
            self.replay.drain(..cut);
        }
        self.emit(PtyEvent::Data { data });
    }

    fn finish(&mut self, code: Option<u32>) {
        self.exited = true;
        self.exit_code = code;
        self.emit(PtyEvent::Exit { code });
    }
}

struct PtyProcess {
    input: Mutex<Option<mpsc::Sender<Vec<u8>>>>,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pid: Option<u32>,
    output: Arc<Mutex<Output>>,
}

impl PtyProcess {
    fn info(&self, id: &str) -> PtyInfo {
        let output = self.output.lock();
        PtyInfo { id: id.to_string(), pid: self.pid, exit_code: output.exit_code, exited: output.exited }
    }

    fn exited(&self) -> bool {
        self.output.lock().exited
    }

    fn close(&self) {
        self.input.lock().take();
        self.master.lock().take();
    }

    fn stop(&self) {
        self.output.lock().channel = None;
        if !self.exited() {
            let _ = self.killer.lock().kill();
        }
        self.close();
    }
}

#[derive(Default)]
pub struct PtyManager {
    processes: Mutex<HashMap<String, Arc<PtyProcess>>>,
    spawning: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

pub fn drain_utf8(pending: &mut Vec<u8>) -> String {
    let mut out = String::with_capacity(pending.len());
    let mut rest: &[u8] = pending;
    loop {
        match std::str::from_utf8(rest) {
            Ok(valid) => {
                out.push_str(valid);
                rest = &[];
                break;
            }
            Err(err) => {
                let (valid, after) = rest.split_at(err.valid_up_to());
                out.push_str(std::str::from_utf8(valid).unwrap_or_default());
                match err.error_len() {
                    Some(len) => {
                        out.push('\u{FFFD}');
                        rest = &after[len..];
                    }
                    None => {
                        rest = after;
                        break;
                    }
                }
            }
        }
    }
    *pending = rest.to_vec();
    out
}

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
    let exe = if cfg!(windows) { format!("{program}.exe") } else { program.to_string() };
    [home.join(".local").join("bin").join(&exe), home.join(".claude").join("local").join(&exe)]
        .into_iter()
        .find(|p| p.is_file())
        .with_context(|| format!("`{program}` was not found on PATH"))
}

pub fn default_shell() -> String {
    if cfg!(windows) {
        ["pwsh.exe", "powershell.exe", "cmd.exe"]
            .into_iter()
            .find(|s| which::which(s).is_ok())
            .unwrap_or("cmd.exe")
            .to_string()
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into())
    }
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

fn is_batch_file(program: &Path) -> bool {
    program.extension().is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
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

fn build_command(req: &SpawnRequest) -> anyhow::Result<CommandBuilder> {
    check_agent_names(&req.args)?;
    let program = resolve_program(&req.program)?;
    if is_batch_file(&program) {
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
    cmd.env("TERM_PROGRAM", "claude-deck");
    if program_stem(&req.program) == "wsl" {
        let forwarded = std::env::var("WSLENV").unwrap_or_default();
        let joined = [forwarded.as_str(), "COLORTERM", "TERM_PROGRAM"]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join(":");
        cmd.env("WSLENV", joined);
    }
    Ok(cmd)
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 }
}

impl PtyManager {
    pub fn spawn(&self, req: SpawnRequest, channel: Channel<PtyEvent>) -> anyhow::Result<PtyInfo> {
        let slot = self.spawning.lock().entry(req.id.clone()).or_default().clone();
        let _spawning = slot.lock();
        let existing = self.processes.lock().get(&req.id).cloned();
        if let Some(existing) = existing {
            if !existing.exited() {
                return self.attach(&req.id, channel);
            }
            existing.close();
            self.processes.lock().remove(&req.id);
        }
        anyhow::ensure!(Path::new(&req.cwd).is_dir(), "Folder does not exist: {}", req.cwd);

        let command = build_command(&req)?;
        let pair = native_pty_system().openpty(size(req.cols, req.rows)).map_err(|e| anyhow!("Could not open a terminal: {e}"))?;
        let mut child = pair.slave.spawn_command(command).map_err(|e| anyhow!("Could not start {}: {e}", req.program))?;
        drop(pair.slave);
        let pipes = pair.master.try_clone_reader().and_then(|reader| pair.master.take_writer().map(|writer| (reader, writer)));
        let (reader, writer) = match pipes {
            Ok(pipes) => pipes,
            Err(error) => {
                let _ = child.kill();
                return Err(anyhow!("Could not connect to the terminal: {error}"));
            }
        };

        let output = Arc::new(Mutex::new(Output { channel: Some(channel), ..Output::default() }));
        let process = Arc::new(PtyProcess {
            input: Mutex::new(Some(spawn_writer(writer))),
            master: Mutex::new(Some(pair.master)),
            killer: Mutex::new(child.clone_killer()),
            pid: child.process_id(),
            output: output.clone(),
        });
        let (chunks_tx, chunks_rx) = mpsc::channel::<String>();
        let (exit_tx, exit_rx) = mpsc::channel::<Option<u32>>();
        spawn_reader(reader, chunks_tx);
        spawn_sender(chunks_rx, exit_rx, output);
        spawn_waiter(child, process.clone(), exit_tx);
        self.processes.lock().insert(req.id.clone(), process.clone());
        Ok(process.info(&req.id))
    }

    pub fn attach(&self, id: &str, channel: Channel<PtyEvent>) -> anyhow::Result<PtyInfo> {
        let process = self.get(id)?;
        let mut output = process.output.lock();
        if !output.replay.is_empty() {
            let _ = channel.send(PtyEvent::Data { data: output.replay.clone() });
        }
        if output.exited {
            let _ = channel.send(PtyEvent::Exit { code: output.exit_code });
        }
        output.channel = Some(channel);
        drop(output);
        Ok(process.info(id))
    }

    fn get(&self, id: &str) -> anyhow::Result<Arc<PtyProcess>> {
        self.processes.lock().get(id).cloned().ok_or_else(|| anyhow!("terminal {id} is not running"))
    }

    pub fn write(&self, id: &str, data: &str) -> anyhow::Result<()> {
        let process = self.get(id)?;
        let input = process.input.lock();
        let sender = input.as_ref().ok_or_else(|| anyhow!("terminal {id} has exited"))?;
        sender.send(data.as_bytes().to_vec()).map_err(|_| anyhow!("terminal {id} has exited"))
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> anyhow::Result<()> {
        let process = self.get(id)?;
        let master = process.master.lock();
        match master.as_ref() {
            Some(master) => master.resize(size(cols, rows)).map_err(|e| anyhow!("{e}")),
            None => Ok(()),
        }
    }

    pub fn kill(&self, id: &str) {
        let removed = self.processes.lock().remove(id);
        self.spawning.lock().remove(id);
        if let Some(process) = removed {
            process.stop();
        }
    }

    pub fn list(&self) -> Vec<PtyInfo> {
        self.processes.lock().iter().map(|(id, p)| p.info(id)).collect()
    }

    pub fn kill_all(&self) {
        let processes: Vec<_> = self.processes.lock().drain().collect();
        for (_, process) in processes {
            process.stop();
        }
    }
}

fn spawn_writer(mut writer: Box<dyn Write + Send>) -> mpsc::Sender<Vec<u8>> {
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    thread::spawn(move || {
        while let Ok(chunk) = rx.recv() {
            if writer.write_all(&chunk).and_then(|_| writer.flush()).is_err() {
                break;
            }
        }
    });
    tx
}

fn spawn_reader(mut reader: Box<dyn Read + Send>, tx: mpsc::Sender<String>) {
    thread::spawn(move || {
        let mut buf = vec![0u8; 64 * 1024];
        let mut pending = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let text = drain_utf8(&mut pending);
                    if !text.is_empty() && tx.send(text).is_err() {
                        break;
                    }
                }
            }
        }
    });
}

fn spawn_sender(rx: mpsc::Receiver<String>, exit: mpsc::Receiver<Option<u32>>, output: Arc<Mutex<Output>>) {
    thread::spawn(move || {
        while let Ok(mut batch) = rx.recv() {
            while batch.len() < SENDER_BATCH_LIMIT {
                match rx.try_recv() {
                    Ok(more) => batch.push_str(&more),
                    Err(_) => break,
                }
            }
            output.lock().push(batch);
        }
        let code = exit.recv().ok().flatten();
        output.lock().finish(code);
    });
}

fn spawn_waiter(mut child: Box<dyn Child + Send + Sync>, process: Arc<PtyProcess>, exit: mpsc::Sender<Option<u32>>) {
    thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        process.master.lock().take();
        process.input.lock().take();
        let _ = exit.send(code);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_incomplete_multibyte_sequence_for_next_read() {
        let bytes = "héllo ✓".as_bytes();
        let mut pending = bytes[..bytes.len() - 1].to_vec();
        assert_eq!(drain_utf8(&mut pending), "héllo ");
        assert_eq!(pending.len(), 2);
        pending.push(*bytes.last().unwrap());
        assert_eq!(drain_utf8(&mut pending), "✓");
        assert!(pending.is_empty());
    }

    #[test]
    fn replaces_invalid_bytes() {
        let mut pending = vec![b'a', 0xff, b'b'];
        assert_eq!(drain_utf8(&mut pending), "a\u{FFFD}b");
        assert!(pending.is_empty());
    }

    #[test]
    fn allows_only_terminal_programs() {
        assert!(ALLOWED_PROGRAMS.contains(&program_stem("C:\\Program Files\\PowerShell\\7\\pwsh.exe").as_str()));
        assert!(ALLOWED_PROGRAMS.contains(&program_stem("wsl.exe").as_str()));
        assert!(!ALLOWED_PROGRAMS.contains(&program_stem("calc.exe").as_str()));
    }

    #[test]
    fn trims_replay_at_a_line_break() {
        let replay = format!("{}{}\n{}", "a".repeat(REPLAY_LIMIT / 2), "x".repeat(500), "b".repeat(REPLAY_LIMIT / 2 - 1000));
        let cut = replay_cut(&replay);
        assert_eq!((&replay[cut - 1..cut], &replay[cut..cut + 1]), ("\n", "b"));
        let unbroken = "é".repeat(REPLAY_LIMIT / 2 + 3);
        assert!(unbroken.is_char_boundary(replay_cut(&unbroken)));
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
