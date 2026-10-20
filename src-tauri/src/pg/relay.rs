use std::{
    io::{self, Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    process::{Command, Stdio},
    sync::Arc,
    thread,
};

use anyhow::Context;
use base64::Engine;
use parking_lot::Mutex;

use crate::{process::Managed, util::hidden};

const RELAY: &str = r#"import socket, sys, threading
s = socket.create_connection((sys.argv[1], int(sys.argv[2])), 10)
s.settimeout(None)
s.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
for name, value in (("TCP_KEEPIDLE", 30), ("TCP_KEEPINTVL", 10), ("TCP_KEEPCNT", 3)):
    if hasattr(socket, name):
        s.setsockopt(socket.IPPROTO_TCP, getattr(socket, name), value)
def upstream():
    while True:
        data = sys.stdin.buffer.read1(65536)
        if not data:
            break
        s.sendall(data)
    try:
        s.shutdown(socket.SHUT_WR)
    except OSError:
        pass
threading.Thread(target=upstream, daemon=True).start()
out = sys.stdout.buffer
while True:
    data = s.recv(65536)
    if not data:
        break
    out.write(data)
    out.flush()
"#;

pub(super) struct Relay {
    pub(super) process: Arc<Managed>,
    stderr: Arc<Mutex<String>>,
}

impl Relay {
    pub(super) fn last_error(&self) -> Option<String> {
        self.stderr.lock().lines().rev().find(|l| !l.trim().is_empty()).map(|l| l.trim().to_string())
    }
}

pub(super) fn wsl_relay(distro: &str, host: &str, port: u16) -> anyhow::Result<(TcpStream, Relay)> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let client = TcpStream::connect(listener.local_addr()?)?;
    let (bridge, _) = listener.accept()?;
    drop(listener);
    let script = format!("import base64;exec(base64.b64decode('{}'))", base64::engine::general_purpose::STANDARD.encode(RELAY));
    let mut command = Command::new("wsl.exe");
    command
        .args(["-d", distro, "-e", "python3", "-c", &script, host, &port.to_string()])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = hidden(&mut command).spawn().context("Couldn't start the WSL relay")?;
    let (mut stdin, mut stdout, mut stderr_pipe) = (
        child.stdin.take().context("missing stdin")?,
        child.stdout.take().context("missing stdout")?,
        child.stderr.take().context("missing stderr")?,
    );
    let process = Arc::new(Managed::new(child)?);
    let stderr: Arc<Mutex<String>> = Arc::default();
    let collected = stderr.clone();
    thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr_pipe.read_to_string(&mut text);
        collected.lock().push_str(&text);
    });
    let mut reader = bridge.try_clone()?;
    thread::spawn(move || {
        let _ = io::copy(&mut reader, &mut stdin);
    });
    let mut writer = bridge;
    let owner = process.clone();
    thread::spawn(move || {
        let _ = io::copy(&mut stdout, &mut writer);
        let _ = writer.flush();
        let _ = writer.shutdown(Shutdown::Both);
        let _ = owner.stop();
    });
    Ok((client, Relay { process, stderr }))
}
