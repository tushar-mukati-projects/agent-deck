use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    process::Command,
    sync::LazyLock,
    time::Duration,
};

use anyhow::{anyhow, Context};
use base64::Engine;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::changes::ChangedFile;
use crate::git::GitChange;
use crate::util::run_with_timeout;
use crate::sessions::{Accumulator, LiveSession, SearchHit, SessionInfo, TranscriptItem};

const AGENT: &str = include_str!("wsl_agent.py");
const BOOTSTRAP: &str = "import sys,base64;exec(base64.b64decode(sys.stdin.readline()))";
const INDEX_TIMEOUT: Duration = Duration::from_secs(90);
const AGENT_TIMEOUT: Duration = Duration::from_secs(30);
const LIST_TIMEOUT: Duration = Duration::from_secs(8);
const UNC_PREFIX: &str = r"\\wsl.localhost\";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Distro {
    pub name: String,
    pub running: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslIndex {
    pub sessions: Vec<SessionInfo>,
    pub shells: HashMap<String, String>,
    pub errors: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Entry {
    size: u64,
    mtime: u64,
    acc: Accumulator,
}

#[derive(Default, Serialize, Deserialize)]
struct DistroCache {
    entries: HashMap<String, Entry>,
    #[serde(skip)]
    live: Vec<LiveSession>,
    #[serde(skip)]
    shell: Option<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Cache {
    distros: HashMap<String, DistroCache>,
    #[serde(skip)]
    loaded: bool,
}

static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(|| Mutex::new(Cache::default()));

#[derive(Deserialize)]
struct IndexChange {
    path: String,
    #[serde(rename = "projectKey")]
    project_key: String,
    size: u64,
    mtime: u64,
    start: u64,
    end: u64,
    records: Vec<Value>,
}

#[derive(Deserialize)]
struct IndexResponse {
    files: Vec<String>,
    changes: Vec<IndexChange>,
    live: Vec<LiveSession>,
    shell: String,
}

fn cache_file() -> PathBuf {
    dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("claude-deck").join("wsl-index.json")
}

fn decode_utf16(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
    String::from_utf16_lossy(&units)
}

fn distro_names(extra: &[&str]) -> Vec<String> {
    let mut args = vec!["-l", "-q"];
    args.extend_from_slice(extra);
    let Ok(output) = run_with_timeout(Command::new("wsl.exe").args(&args), None, LIST_TIMEOUT) else { return Vec::new() };
    if !output.status.success() {
        return Vec::new();
    }
    decode_utf16(&output.stdout)
        .lines()
        .map(|l| l.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}' || c == '\0').to_string())
        .filter(|name| !name.is_empty() && !name.starts_with("docker-desktop"))
        .collect()
}

pub fn distros() -> Vec<Distro> {
    if !cfg!(windows) {
        return Vec::new();
    }
    let running = distro_names(&["--running"]);
    distro_names(&[])
        .into_iter()
        .map(|name| Distro { running: running.contains(&name), name })
        .collect()
}

pub fn host_path(distro: &str, linux_path: &str) -> String {
    format!("{UNC_PREFIX}{distro}{}", linux_path.replace('/', "\\"))
}

pub fn parse_host_path(path: &str) -> Option<(String, String)> {
    let lower = path.to_lowercase();
    let rest = [r"\\wsl.localhost\", r"\\wsl$\"]
        .iter()
        .find(|prefix| lower.starts_with(*prefix))
        .map(|prefix| &path[prefix.len()..])?;
    let (distro, tail) = rest.split_once('\\').unwrap_or((rest, ""));
    Some((distro.to_string(), format!("/{}", tail.replace('\\', "/"))))
}

fn run_agent_with(distro: &str, args: &[&str], input: Option<String>, timeout: Duration) -> anyhow::Result<Value> {
    let script = base64::engine::general_purpose::STANDARD.encode(AGENT);
    let payload = format!("{script}\n{}", input.unwrap_or_default());
    let output = run_with_timeout(
        Command::new("wsl.exe").args(["-d", distro, "-e", "python3", "-c", BOOTSTRAP]).args(args),
        Some(payload.as_bytes()),
        timeout,
    )
    .with_context(|| format!("WSL {distro} didn't respond"))?;
    let value: Value = serde_json::from_slice(&output.stdout).map_err(|_| {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow!("WSL {distro}: {}", stderr.trim().lines().last().unwrap_or("agent failed (is python3 installed?)"))
    })?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(anyhow!("WSL {distro}: {error}"));
    }
    Ok(value)
}

fn run_agent(distro: &str, args: &[&str], input: Option<String>) -> anyhow::Result<Value> {
    run_agent_with(distro, args, input, AGENT_TIMEOUT)
}

fn ensure_loaded(cache: &mut Cache) {
    if cache.loaded {
        return;
    }
    cache.loaded = true;
    if let Ok(text) = std::fs::read_to_string(cache_file()) {
        if let Ok(saved) = serde_json::from_str::<Cache>(&text) {
            cache.distros = saved.distros;
        }
    }
}

fn serialize(cache: &Cache) -> Option<String> {
    serde_json::to_string(cache).ok()
}

fn persist(text: String) {
    let path = cache_file();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, text).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

fn session_info(distro: &str, path: &str, entry: &Entry) -> Option<SessionInfo> {
    let mut info = entry.acc.finish_with(entry.mtime, entry.size)?;
    info.cwd = host_path(distro, &info.cwd);
    info.distro = Some(distro.to_string());
    info.file_path = path.to_string();
    Some(info)
}

fn index_distro(distro: &str) -> anyhow::Result<()> {
    let offsets: HashMap<String, Value> = {
        let mut cache = CACHE.lock();
        ensure_loaded(&mut cache);
        cache
            .distros
            .get(distro)
            .map(|d| {
                d.entries
                    .iter()
                    .map(|(path, e)| {
                        (path.clone(), serde_json::json!({ "size": e.size, "mtime": e.mtime, "offset": e.acc_offset() }))
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let request = serde_json::json!({ "offsets": offsets }).to_string();
    let response: IndexResponse =
        serde_json::from_value(run_agent_with(distro, &["index"], Some(request), INDEX_TIMEOUT)?)?;

    let mut cache = CACHE.lock();
    let state = cache.distros.entry(distro.to_string()).or_default();
    let changed = !response.changes.is_empty() || state.entries.len() != response.files.len();
    for change in response.changes {
        let fresh = || {
            let id = change.path.rsplit('/').next().unwrap_or_default().trim_end_matches(".jsonl").to_string();
            Accumulator::with_ids(id, change.path.clone(), &change.project_key, Some(distro.to_string()))
        };
        let mut acc = match state.entries.get(&change.path) {
            Some(existing) if change.start > 0 && existing.acc_offset() == change.start => existing.acc.clone(),
            _ if change.start > 0 => {
                state.entries.remove(&change.path);
                continue;
            }
            _ => fresh(),
        };
        for record in &change.records {
            acc.feed(&record.to_string());
        }
        acc.set_offset(change.end);
        state.entries.insert(change.path.clone(), Entry { size: change.size, mtime: change.mtime, acc });
    }
    let present: HashSet<&String> = response.files.iter().collect();
    state.entries.retain(|path, _| present.contains(path));
    state.live = response
        .live
        .into_iter()
        .map(|mut live| {
            live.distro = Some(distro.to_string());
            live
        })
        .collect();
    state.shell = Some(response.shell);
    let snapshot = changed.then(|| serialize(&cache)).flatten();
    drop(cache);
    if let Some(text) = snapshot {
        persist(text);
    }
    Ok(())
}

static INDEX_LOCK: Mutex<()> = Mutex::new(());

pub fn index() -> WslIndex {
    let _guard = INDEX_LOCK.lock();
    let running: Vec<String> = distros().into_iter().filter(|d| d.running).map(|d| d.name).collect();
    let mut errors = HashMap::new();
    for distro in &running {
        if let Err(error) = index_distro(distro) {
            errors.insert(distro.clone(), format!("{error:#}"));
        }
    }
    let cache = CACHE.lock();
    let mut sessions = Vec::new();
    let mut shells = HashMap::new();
    for distro in &running {
        let Some(state) = cache.distros.get(distro) else { continue };
        if let Some(shell) = &state.shell {
            shells.insert(distro.clone(), shell.clone());
        }
        sessions.extend(state.entries.iter().filter_map(|(path, entry)| session_info(distro, path, entry)));
    }
    sessions.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    WslIndex { sessions, shells, errors }
}

pub fn live_sessions() -> Vec<LiveSession> {
    CACHE.lock().distros.values().flat_map(|d| d.live.clone()).collect()
}

pub fn transcript(distro: &str, path: &str) -> anyhow::Result<Vec<TranscriptItem>> {
    let value = run_agent(distro, &["transcript", path], None)?;
    let lines = value
        .get("lines")
        .and_then(Value::as_array)
        .context("unexpected transcript response")?
        .iter()
        .map(|line| line.to_string())
        .collect::<Vec<_>>();
    Ok(crate::sessions::transcript_from_lines(lines.into_iter()))
}

pub fn delete_session(distro: &str, path: &str) -> anyhow::Result<()> {
    let session_id = path.rsplit('/').next().unwrap_or_default().trim_end_matches(".jsonl");
    anyhow::ensure!(
        !live_sessions().iter().any(|l| l.session_id == session_id),
        "This session is still running in WSL. Close it first."
    );
    run_agent(distro, &["delete", path], None)?;
    let snapshot = {
        let mut cache = CACHE.lock();
        if let Some(state) = cache.distros.get_mut(distro) {
            state.entries.remove(path);
        }
        serialize(&cache)
    };
    if let Some(text) = snapshot {
        persist(text);
    }
    Ok(())
}

pub fn list_files(distro: &str, linux_root: &str) -> anyhow::Result<Vec<String>> {
    let value = run_agent(distro, &["files", linux_root], None)?;
    Ok(value
        .get("files")
        .and_then(Value::as_array)
        .map(|files| files.iter().filter_map(|f| f.as_str().map(|s| s.replace('/', "\\"))).collect())
        .unwrap_or_default())
}

fn text_field(value: Value) -> anyhow::Result<String> {
    value.get("text").and_then(Value::as_str).map(str::to_string).context("unexpected response")
}

pub fn session_changes(distro: &str, path: &str) -> anyhow::Result<Vec<ChangedFile>> {
    let value = run_agent(distro, &["changes", path], None)?;
    let files: Vec<ChangedFile> = serde_json::from_value(value.get("files").cloned().unwrap_or_default())?;
    Ok(files.into_iter().map(|f| ChangedFile { path: host_path(distro, &f.path), ..f }).collect())
}

pub fn session_backup(distro: &str, path: &str, backup: &str) -> anyhow::Result<String> {
    text_field(run_agent(distro, &["backup", path, backup], None)?)
}

pub fn git_status(distro: &str, linux_root: &str) -> anyhow::Result<Vec<GitChange>> {
    let value = run_agent(distro, &["git_status", linux_root], None)?;
    let changes: Vec<GitChange> = serde_json::from_value(value.get("changes").cloned().unwrap_or_default())?;
    Ok(changes.into_iter().map(|c| GitChange { path: host_path(distro, &c.path), ..c }).collect())
}

pub fn git_head_file(distro: &str, linux_path: &str) -> anyhow::Result<String> {
    text_field(run_agent(distro, &["git_head", linux_path], None)?)
}

pub fn rename_session(distro: &str, path: &str, title: &str) -> anyhow::Result<()> {
    run_agent(distro, &["rename", path], Some(title.to_string()))?;
    Ok(())
}

pub fn search(query: &str) -> Vec<SearchHit> {
    distros()
        .into_iter()
        .filter(|d| d.running)
        .filter_map(|d| run_agent(&d.name, &["search"], Some(query.to_string())).ok())
        .filter_map(|value| serde_json::from_value::<Vec<SearchHit>>(value.get("hits")?.clone()).ok())
        .flatten()
        .collect()
}

pub fn is_running(distro: &str) -> bool {
    distro_names(&["--running"]).iter().any(|name| name == distro)
}

static HOMES: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Mutex::default);

pub fn home_for(distro: &str, linux_cwd: &str) -> anyhow::Result<String> {
    let mut parts = linux_cwd.split('/').filter(|p| !p.is_empty());
    match (parts.next(), parts.next()) {
        (Some("home"), Some(user)) => return Ok(format!("/home/{user}")),
        (Some("root"), _) => return Ok("/root".into()),
        _ => {}
    }
    if let Some(home) = HOMES.lock().get(distro) {
        return Ok(home.clone());
    }
    let output = run_with_timeout(
        Command::new("wsl.exe").args(["-d", distro, "-e", "sh", "-c", "printf %s \"$HOME\""]),
        None,
        LIST_TIMEOUT,
    )?;
    let home = String::from_utf8_lossy(&output.stdout).trim().to_string();
    anyhow::ensure!(home.starts_with('/'), "Couldn't find the home folder in WSL {distro}");
    HOMES.lock().insert(distro.to_string(), home.clone());
    Ok(home)
}

pub fn login_shell(distro: &str) -> String {
    CACHE.lock().distros.get(distro).and_then(|d| d.shell.clone()).unwrap_or_else(|| "bash".into())
}

pub fn start(distro: &str) -> anyhow::Result<()> {
    let output = run_with_timeout(Command::new("wsl.exe").args(["-d", distro, "-e", "true"]), None, INDEX_TIMEOUT)?;
    anyhow::ensure!(output.status.success(), "Couldn't start WSL distro {distro}");
    Ok(())
}

impl Entry {
    fn acc_offset(&self) -> u64 {
        self.acc.offset()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_between_linux_and_host_paths() {
        let host = host_path("Debian", "/home/me/work");
        assert_eq!(host, r"\\wsl.localhost\Debian\home\me\work");
        assert_eq!(parse_host_path(&host), Some(("Debian".into(), "/home/me/work".into())));
        assert_eq!(parse_host_path(r"\\wsl$\Ubuntu"), Some(("Ubuntu".into(), "/".into())));
        assert_eq!(parse_host_path(r"C:\Users"), None);
    }

    #[test]
    #[ignore]
    fn probe_real_wsl() {
        let start = std::time::Instant::now();
        let result = index();
        println!("wsl sessions={} errors={:?} shells={:?} in {:?}", result.sessions.len(), result.errors, result.shells, start.elapsed());
        for s in result.sessions.iter().take(5) {
            println!("{} | {:?} | {} | prompts={}", s.id, s.title, s.cwd, s.prompt_count);
        }
        let start = std::time::Instant::now();
        let again = index();
        println!("warm={} in {:?} live={}", again.sessions.len(), start.elapsed(), live_sessions().len());
        let first = &result.sessions[0];
        let t = transcript(first.distro.as_deref().unwrap(), &first.file_path).unwrap();
        println!("transcript items={}", t.len());
    }
}
