use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{mpsc, Arc},
    thread,
};

use anyhow::{anyhow, Context};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

const REPLAY_LIMIT: usize = 2 * 1024 * 1024;
const SENDER_BATCH_LIMIT: usize = 512 * 1024;

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

fn inherited_terminal_vars() -> impl Iterator<Item = String> {
    std::env::vars_os()
        .filter_map(|(key, _)| key.into_string().ok())
        .filter(|key| SCRUBBED_ENV_PREFIXES.iter().any(|prefix| key.starts_with(prefix)))
}

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

struct Output {
    replay: String,
    channel: Option<Channel<PtyEvent>>,
    exited: bool,
    exit_code: Option<u32>,
}

struct PtyProcess {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    pid: Option<u32>,
    output: Mutex<Output>,
}

impl PtyProcess {
    fn emit(&self, event: PtyEvent) {
        let output = self.output.lock();
        if let Some(channel) = &output.channel {
            let _ = channel.send(event);
        }
    }

    fn push_data(&self, data: String) {
        let mut output = self.output.lock();
        output.replay.push_str(&data);
        if output.replay.len() > REPLAY_LIMIT {
            let mut cut = output.replay.len() - REPLAY_LIMIT / 2;
            while !output.replay.is_char_boundary(cut) {
                cut += 1;
            }
            output.replay.drain(..cut);
        }
        if let Some(channel) = &output.channel {
            let _ = channel.send(PtyEvent::Data { data });
        }
    }

    fn info(&self, id: &str) -> PtyInfo {
        let output = self.output.lock();
        PtyInfo {
            id: id.to_string(),
            pid: self.pid,
            exit_code: output.exit_code,
            exited: output.exited,
        }
    }
}

#[derive(Default)]
pub struct PtyManager {
    processes: Mutex<HashMap<String, Arc<PtyProcess>>>,
}

fn drain_utf8(pending: &mut Vec<u8>) -> String {
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
    let leftover = rest.to_vec();
    *pending = leftover;
    out
}

fn resolve_program(program: &str) -> anyhow::Result<std::path::PathBuf> {
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

impl PtyManager {
    pub fn spawn(&self, req: SpawnRequest, channel: Channel<PtyEvent>) -> anyhow::Result<PtyInfo> {
        if let Some(existing) = self.processes.lock().get(&req.id).cloned() {
            existing.output.lock().channel = Some(channel);
            return Ok(existing.info(&req.id));
        }
        anyhow::ensure!(std::path::Path::new(&req.cwd).is_dir(), "Folder does not exist: {}", req.cwd);

        let pair = native_pty_system()
            .openpty(PtySize { rows: req.rows.max(2), cols: req.cols.max(10), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| anyhow!("Could not open a terminal: {e}"))?;

        let mut cmd = CommandBuilder::new(resolve_program(&req.program)?);
        cmd.args(&req.args);
        cmd.cwd(&req.cwd);
        for key in SCRUBBED_ENV.iter().map(|k| k.to_string()).chain(inherited_terminal_vars()) {
            cmd.env_remove(key);
        }
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("TERM_PROGRAM", "claude-deck");
        if req.program.eq_ignore_ascii_case("wsl.exe") {
            let forwarded = std::env::var("WSLENV").unwrap_or_default();
            let joined = [forwarded.as_str(), "COLORTERM", "TERM_PROGRAM"]
                .into_iter()
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(":");
            cmd.env("WSLENV", joined);
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| anyhow!("Could not start {}: {e}", req.program))?;
        drop(pair.slave);

        let reader = pair.master.try_clone_reader().map_err(|e| anyhow!("{e}"))?;
        let writer = pair.master.take_writer().map_err(|e| anyhow!("{e}"))?;
        let process = Arc::new(PtyProcess {
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            killer: Mutex::new(child.clone_killer()),
            pid: child.process_id(),
            output: Mutex::new(Output { replay: String::new(), channel: Some(channel), exited: false, exit_code: None }),
        });
        self.processes.lock().insert(req.id.clone(), process.clone());

        let (tx, rx) = mpsc::channel::<String>();
        spawn_reader(reader, tx);
        spawn_sender(rx, process.clone());

        let waiter = process.clone();
        thread::spawn(move || {
            let code = child.wait().ok().map(|s| s.exit_code());
            {
                let mut output = waiter.output.lock();
                output.exited = true;
                output.exit_code = code;
            }
            waiter.emit(PtyEvent::Exit { code });
        });

        Ok(process.info(&req.id))
    }

    pub fn attach(&self, id: &str, channel: Channel<PtyEvent>) -> anyhow::Result<PtyInfo> {
        let process = self.get(id)?;
        {
            let mut output = process.output.lock();
            if !output.replay.is_empty() {
                let _ = channel.send(PtyEvent::Data { data: output.replay.clone() });
            }
            if output.exited {
                let _ = channel.send(PtyEvent::Exit { code: output.exit_code });
            }
            output.channel = Some(channel);
        }
        Ok(process.info(id))
    }

    fn get(&self, id: &str) -> anyhow::Result<Arc<PtyProcess>> {
        self.processes.lock().get(id).cloned().ok_or_else(|| anyhow!("terminal {id} is not running"))
    }

    pub fn write(&self, id: &str, data: &str) -> anyhow::Result<()> {
        let process = self.get(id)?;
        let mut writer = process.writer.lock();
        writer.write_all(data.as_bytes())?;
        writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> anyhow::Result<()> {
        let process = self.get(id)?;
        let master = process.master.lock();
        master
            .resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
            .map_err(|e| anyhow!("{e}"))
    }

    pub fn kill(&self, id: &str) -> anyhow::Result<()> {
        let Some(process) = self.processes.lock().remove(id) else { return Ok(()) };
        if !process.output.lock().exited {
            let _ = process.killer.lock().kill();
        }
        process.output.lock().channel = None;
        Ok(())
    }

    pub fn list(&self) -> Vec<PtyInfo> {
        self.processes.lock().iter().map(|(id, p)| p.info(id)).collect()
    }

    pub fn kill_all(&self) {
        let processes: Vec<_> = self.processes.lock().drain().collect();
        for (_, process) in processes {
            let _ = process.killer.lock().kill();
        }
    }
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

fn spawn_sender(rx: mpsc::Receiver<String>, process: Arc<PtyProcess>) {
    thread::spawn(move || {
        while let Ok(mut batch) = rx.recv() {
            while batch.len() < SENDER_BATCH_LIMIT {
                match rx.try_recv() {
                    Ok(more) => batch.push_str(&more),
                    Err(_) => break,
                }
            }
            process.push_data(batch);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::drain_utf8;

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
}
