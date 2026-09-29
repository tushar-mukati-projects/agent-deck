use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, LazyLock},
    thread,
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context};
use base64::Engine;
use parking_lot::Mutex;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, value::RawValue, Value};

use crate::{
    changes::ChangedFile,
    git::GitChange,
    sessions::{self, Accumulator, LiveSession, Needle, SearchHit, SessionInfo, TranscriptPage},
    tasks,
    util::{hidden, run_with_timeout},
};

const AGENT: &str = include_str!("wsl_agent.py");
const BOOTSTRAP: &str = "import sys,base64;exec(base64.b64decode(sys.stdin.readline()))";
const INDEX_TIMEOUT: Duration = Duration::from_secs(90);
const INDEX_ROUNDS: Duration = Duration::from_secs(60);
const AGENT_TIMEOUT: Duration = Duration::from_secs(30);
const LIST_TIMEOUT: Duration = Duration::from_secs(8);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(20);
const RUNNING_TTL: Duration = Duration::from_secs(5);
const LIVE_TTL: Duration = Duration::from_secs(30);
const UNC_PREFIX: &str = r"\\wsl.localhost\";
const FORWARDED_VARS: [&str; 2] = ["CLAUDE_CONFIG_DIR", "CODEX_HOME"];

static SCRIPT: LazyLock<String> = LazyLock::new(|| base64::engine::general_purpose::STANDARD.encode(AGENT));

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Distro {
    pub name: String,
    pub running: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WslIndex {
    pub sessions: Vec<SessionInfo>,
    pub errors: HashMap<String, String>,
    pub distros: Vec<Distro>,
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
    live_at: Option<Instant>,
    #[serde(skip)]
    shell: Option<String>,
}

const CACHE_VERSION: u32 = 2;

#[derive(Default, Serialize, Deserialize)]
struct Cache {
    #[serde(default)]
    version: u32,
    distros: HashMap<String, DistroCache>,
}

static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(|| Mutex::new(load_cache()));
static SAVE_LOCK: Mutex<()> = Mutex::new(());
static INDEX_LOCK: Mutex<()> = Mutex::new(());
static RUNNING: Mutex<Option<(Instant, Vec<String>)>> = Mutex::new(None);
static HOMES: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Mutex::default);
type LoginEnv = Option<Arc<HashMap<String, String>>>;
type LoginSlot = Arc<Mutex<Option<LoginEnv>>>;
static LOGIN_ENV: LazyLock<Mutex<HashMap<String, LoginSlot>>> = LazyLock::new(Mutex::default);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexChange {
    path: String,
    project_key: String,
    size: u64,
    mtime: u64,
    start: u64,
    end: u64,
    records: Vec<Box<RawValue>>,
}

#[derive(Deserialize)]
struct IndexResponse {
    files: Vec<String>,
    changes: Vec<IndexChange>,
    live: Vec<Value>,
    shell: String,
    #[serde(default)]
    more: bool,
}

#[derive(Deserialize)]
struct Lines {
    lines: Vec<Box<RawValue>>,
    #[serde(default)]
    start: u64,
    #[serde(default)]
    end: u64,
}

#[derive(Deserialize)]
struct ErrorReply {
    error: Option<String>,
}

#[cfg(not(test))]
fn cache_file() -> PathBuf {
    dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join("claude-deck").join("wsl-index.json")
}

#[cfg(test)]
fn cache_file() -> PathBuf {
    std::env::temp_dir().join("claude-deck-test").join("wsl-index.json")
}

fn load_cache() -> Cache {
    std::fs::read_to_string(cache_file())
        .ok()
        .and_then(|text| serde_json::from_str::<Cache>(&text).ok())
        .filter(|cache| cache.version == CACHE_VERSION)
        .unwrap_or(Cache { version: CACHE_VERSION, distros: HashMap::new() })
}

fn save() {
    let _guard = SAVE_LOCK.lock();
    let Ok(text) = serde_json::to_string(&*CACHE.lock()) else { return };
    let path = cache_file();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("tmp");
    if std::fs::write(&tmp, text).is_ok() {
        let _ = std::fs::rename(&tmp, &path);
    }
}

pub fn decode_output(bytes: &[u8]) -> String {
    let sample = &bytes[..bytes.len().min(256)];
    let odd_nuls = sample.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
    if sample.len() >= 2 && odd_nuls * 4 >= sample.len() {
        let units: Vec<u16> = bytes.as_chunks::<2>().0.iter().map(|c| u16::from_le_bytes(*c)).collect();
        String::from_utf16_lossy(&units).trim_start_matches('\u{feff}').to_string()
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

fn distro_names(running: bool) -> Vec<String> {
    let mut command = Command::new("wsl.exe");
    command.args(["-l", "-q"]);
    if running {
        command.arg("--running");
    }
    let Ok(output) = run_with_timeout(&mut command, None, LIST_TIMEOUT) else { return Vec::new() };
    if !output.status.success() {
        return Vec::new();
    }
    decode_output(&output.stdout)
        .lines()
        .map(|l| l.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}' || c == '\0').to_string())
        .filter(|name| !name.is_empty() && !name.starts_with("docker-desktop"))
        .collect()
}

fn running_names(fresh: bool) -> Vec<String> {
    if let Some((at, names)) = RUNNING.lock().as_ref() {
        if !fresh && at.elapsed() < RUNNING_TTL {
            return names.clone();
        }
    }
    let names = distro_names(true);
    *RUNNING.lock() = Some((Instant::now(), names.clone()));
    names
}

pub fn distros() -> Vec<Distro> {
    if !cfg!(windows) {
        return Vec::new();
    }
    let running = running_names(true);
    distro_names(false).into_iter().map(|name| Distro { running: running.contains(&name), name }).collect()
}

pub fn is_running(distro: &str) -> bool {
    running_names(false).iter().any(|name| name == distro)
}

pub fn host_path(distro: &str, linux_path: &str) -> String {
    format!("{UNC_PREFIX}{distro}{}", linux_path.replace('/', "\\"))
}

fn host_of(distro: &str, path: &str) -> String {
    if path.starts_with('/') {
        host_path(distro, path)
    } else {
        path.to_string()
    }
}

pub fn parse_host_path(path: &str) -> Option<(String, String)> {
    let lower = path.to_lowercase();
    let rest = [r"\\wsl.localhost\", r"\\wsl$\", r"\\?\unc\wsl.localhost\", r"\\?\unc\wsl$\", "//wsl.localhost/", "//wsl$/"]
        .iter()
        .find(|prefix| lower.starts_with(*prefix))
        .map(|prefix| &path[prefix.len()..])?;
    let rest = rest.replace('/', "\\");
    let (distro, tail) = rest.split_once('\\').unwrap_or((&rest, ""));
    (!distro.is_empty()).then(|| (distro.to_string(), format!("/{}", tail.replace('\\', "/"))))
}

fn agent_command(distro: &str, args: &[&str]) -> Command {
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
    let existing = std::env::var("WSLENV").unwrap_or_default();
    let listed = forwarded.iter().map(|k| format!("{k}/u")).collect::<Vec<_>>().join(":");
    command.env("WSLENV", if existing.is_empty() { listed } else { format!("{existing}:{listed}") });
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

fn run_agent_with<T: DeserializeOwned>(distro: &str, args: &[&str], input: Option<String>, timeout: Duration) -> anyhow::Result<T> {
    let mut command = agent_command(distro, args);
    forward_login_vars(&mut command, distro);
    let bytes = run_agent_raw(command, distro, input, timeout)?;
    serde_json::from_slice(&bytes).with_context(|| format!("WSL {distro} sent an unexpected reply"))
}

fn run_agent<T: DeserializeOwned>(distro: &str, args: &[&str], input: Option<String>) -> anyhow::Result<T> {
    run_agent_with(distro, args, input, AGENT_TIMEOUT)
}

fn login_slot(distro: &str) -> LoginSlot {
    LOGIN_ENV.lock().entry(distro.to_string()).or_default().clone()
}

fn known_login_env(distro: &str) -> LoginEnv {
    let slot = login_slot(distro);
    let value = slot.try_lock()?;
    if let Some(env) = value.as_ref() {
        return env.clone();
    }
    drop(value);
    let distro = distro.to_string();
    thread::spawn(move || login_env(&distro));
    None
}

pub fn login_env(distro: &str) -> LoginEnv {
    let slot = login_slot(distro);
    let mut value = slot.lock();
    if let Some(env) = value.as_ref() {
        return env.clone();
    }
    #[derive(Deserialize)]
    struct Reply {
        shell: String,
        env: HashMap<String, String>,
    }
    let reply = run_agent_raw(agent_command(distro, &["loginenv"]), distro, None, LOGIN_TIMEOUT)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Reply>(&bytes).ok());
    let env = reply.map(|reply| {
        CACHE.lock().distros.entry(distro.to_string()).or_default().shell = Some(reply.shell);
        Arc::new(reply.env)
    });
    *value = Some(env.clone());
    env
}

pub fn login_var(distro: &str, name: &str) -> Option<String> {
    login_env(distro)?.get(name).cloned()
}

fn session_info(distro: &str, path: &str, entry: &Entry) -> Option<SessionInfo> {
    let mut info = entry.acc.finish_with(entry.mtime, entry.size)?;
    info.cwd = host_of(distro, &info.cwd);
    info.recent_cwds = info.recent_cwds.iter().map(|cwd| host_of(distro, cwd)).collect();
    info.distro = Some(distro.to_string());
    info.file_path = path.to_string();
    Some(info)
}

fn apply_index(distro: &str, response: IndexResponse) -> bool {
    let mut cache = CACHE.lock();
    let state = cache.distros.entry(distro.to_string()).or_default();
    let mut changed = !response.changes.is_empty() || state.entries.len() != response.files.len();
    for change in response.changes {
        let resumed = state.entries.get(&change.path).filter(|e| change.start > 0 && e.acc.offset() == change.start);
        let mut acc = match resumed {
            Some(existing) => existing.acc.clone(),
            None if change.start > 0 => {
                state.entries.remove(&change.path);
                continue;
            }
            None => {
                let id = sessions::session_id_for(change.path.rsplit('/').next().unwrap_or_default());
                Accumulator::with_ids(id, change.path.clone(), &change.project_key, Some(distro.to_string()))
            }
        };
        for record in &change.records {
            acc.feed(record.get());
        }
        acc.set_offset(change.end);
        state.entries.insert(change.path.clone(), Entry { size: change.size, mtime: change.mtime, acc });
    }
    let present: HashSet<&String> = response.files.iter().collect();
    let before = state.entries.len();
    state.entries.retain(|path, _| present.contains(path));
    changed |= before != state.entries.len();
    state.live = response
        .live
        .into_iter()
        .filter_map(|value| serde_json::from_value::<LiveSession>(value).ok())
        .map(|live| LiveSession { distro: Some(distro.to_string()), ..live })
        .collect();
    state.live_at = Some(Instant::now());
    state.shell = Some(response.shell);
    changed
}

fn index_distro(distro: &str) -> anyhow::Result<bool> {
    let started = Instant::now();
    let mut changed = false;
    loop {
        let offsets: HashMap<String, Value> = CACHE
            .lock()
            .distros
            .get(distro)
            .map(|d| {
                d.entries
                    .iter()
                    .map(|(path, e)| (path.clone(), json!({ "size": e.size, "mtime": e.mtime, "offset": e.acc.offset() })))
                    .collect()
            })
            .unwrap_or_default();
        let request = json!({ "offsets": offsets }).to_string();
        let response: IndexResponse = run_agent_with(distro, &["index"], Some(request), INDEX_TIMEOUT)?;
        let more = response.more;
        changed |= apply_index(distro, response);
        if !more || started.elapsed() > INDEX_ROUNDS {
            return Ok(changed);
        }
        if changed {
            save();
        }
    }
}

pub fn index() -> WslIndex {
    let _guard = INDEX_LOCK.lock();
    let distros = distros();
    let running: Vec<String> = distros.iter().filter(|d| d.running).map(|d| d.name.clone()).collect();
    for distro in &running {
        known_login_env(distro);
    }
    let results: Vec<(String, anyhow::Result<bool>)> = thread::scope(|scope| {
        let handles: Vec<_> = running.iter().map(|d| (d.clone(), scope.spawn(move || index_distro(d)))).collect();
        handles.into_iter().map(|(d, h)| (d, h.join().unwrap_or_else(|_| Err(anyhow!("indexing stopped unexpectedly"))))).collect()
    });
    let mut errors = HashMap::new();
    let mut changed = false;
    for (distro, result) in results {
        match result {
            Ok(did_change) => changed |= did_change,
            Err(error) => {
                errors.insert(distro, format!("{error:#}"));
            }
        }
    }
    let sessions = {
        let mut cache = CACHE.lock();
        for (name, state) in cache.distros.iter_mut() {
            if !running.contains(name) || errors.contains_key(name) {
                state.live.clear();
                state.live_at = None;
            }
        }
        let mut sessions = Vec::new();
        for distro in &running {
            let Some(state) = cache.distros.get(distro) else { continue };
            sessions.extend(state.entries.iter().filter_map(|(path, entry)| session_info(distro, path, entry)));
        }
        sessions
    };
    if changed {
        save();
    }
    let mut sessions = sessions;
    sessions.sort_by_key(|s| std::cmp::Reverse(s.modified_ms));
    WslIndex { sessions, errors, distros }
}

pub fn live_sessions() -> Vec<LiveSession> {
    CACHE
        .lock()
        .distros
        .values()
        .filter(|d| d.live_at.is_some_and(|at| at.elapsed() < LIVE_TTL))
        .flat_map(|d| d.live.clone())
        .collect()
}

pub fn session_tasks(distro: &str, path: &str) -> anyhow::Result<Vec<tasks::AgentTask>> {
    let key = format!("{distro}\n{path}");
    let mut log = tasks::take(&key);
    let reply: Lines = run_agent(distro, &["tasks", path, &log.offset.to_string()], None)?;
    if reply.start == 0 && log.offset != 0 {
        log = tasks::TaskLog::default();
    }
    for line in &reply.lines {
        log.feed(line.get());
    }
    log.offset = reply.end;
    let found = log.tasks();
    tasks::put(&key, log);
    Ok(found
        .into_iter()
        .map(|task| tasks::AgentTask { output_path: task.output_path.as_deref().map(|p| host_of(distro, p)), ..task })
        .collect())
}

pub fn transcript(distro: &str, path: &str, from_offset: u64) -> anyhow::Result<TranscriptPage> {
    let reply: Lines = run_agent(distro, &["transcript", path, &from_offset.to_string()], None)?;
    Ok(TranscriptPage {
        items: sessions::transcript_from_lines(reply.lines.iter().map(|l| l.get())),
        offset: reply.end,
        reset: reply.start == 0,
    })
}

pub fn delete_session(distro: &str, path: &str) -> anyhow::Result<()> {
    let session_id = sessions::session_id_for(path.rsplit('/').next().unwrap_or_default());
    anyhow::ensure!(
        !live_sessions().iter().any(|l| l.session_id == session_id),
        "This session is still running in WSL. Close it first."
    );
    let _: Value = run_agent(distro, &["delete", path], None)?;
    if let Some(state) = CACHE.lock().distros.get_mut(distro) {
        state.entries.remove(path);
    }
    save();
    Ok(())
}

pub fn list_files(distro: &str, linux_root: &str) -> anyhow::Result<Vec<String>> {
    #[derive(Deserialize)]
    struct Files {
        files: Vec<String>,
    }
    let reply: Files = run_agent(distro, &["files", linux_root], None)?;
    Ok(reply.files.into_iter().map(|f| f.replace('/', "\\")).collect())
}

#[derive(Deserialize)]
struct Text {
    text: String,
}

fn existing_files(distro: &str, paths: &[String]) -> HashSet<String> {
    #[derive(Deserialize)]
    struct Exists {
        exists: Vec<String>,
    }
    let absolute: Vec<&String> = paths.iter().filter(|p| p.starts_with('/')).collect();
    if absolute.is_empty() {
        return HashSet::new();
    }
    match run_agent::<Exists>(distro, &["exists"], Some(json!(absolute).to_string())) {
        Ok(reply) => reply.exists.into_iter().collect(),
        Err(_) => absolute.into_iter().filter(|p| std::path::Path::new(&host_path(distro, p)).is_file()).cloned().collect(),
    }
}

pub fn session_changes(distro: &str, path: &str) -> anyhow::Result<Vec<ChangedFile>> {
    #[derive(Deserialize)]
    struct Reply {
        lines: Option<Vec<Box<RawValue>>>,
        files: Option<Vec<ChangedFile>>,
    }
    let reply: Reply = run_agent(distro, &["changes", path], None)?;
    let files = match reply.lines {
        Some(lines) => crate::codex::changes_from_lines(lines.iter().map(|l| l.get().to_string()), |paths| existing_files(distro, paths)),
        None => reply.files.unwrap_or_default(),
    };
    Ok(files.into_iter().map(|f| ChangedFile { path: host_of(distro, &f.path), ..f }).collect())
}

pub fn session_backup(distro: &str, path: &str, backup: &str) -> anyhow::Result<String> {
    Ok(run_agent::<Text>(distro, &["backup", path, backup], None)?.text)
}

pub fn git_status(distro: &str, linux_root: &str) -> anyhow::Result<Vec<GitChange>> {
    #[derive(Deserialize)]
    struct Changes {
        changes: Vec<GitChange>,
    }
    let reply: Changes = run_agent(distro, &["git_status", linux_root], None)?;
    Ok(reply.changes.into_iter().map(|c| GitChange { path: host_of(distro, &c.path), ..c }).collect())
}

pub fn git_head_file(distro: &str, linux_path: &str) -> anyhow::Result<String> {
    Ok(run_agent::<Text>(distro, &["git_head", linux_path], None)?.text)
}

pub fn rename_session(distro: &str, path: &str, title: &str) -> anyhow::Result<()> {
    let _: Value = run_agent(distro, &["rename", path], Some(title.to_string()))?;
    Ok(())
}

pub fn search(needle: &Needle, generation: u64) -> Vec<SearchHit> {
    #[derive(Deserialize)]
    struct Found {
        path: String,
        lines: Vec<Box<RawValue>>,
    }
    #[derive(Deserialize)]
    struct Reply {
        files: Vec<Found>,
    }
    let request = json!({ "prefilter": needle.prefilter, "fold": needle.fold_ascii, "query": needle.lower }).to_string();
    let running = running_names(false);
    thread::scope(|scope| {
        let handles: Vec<_> = running
            .iter()
            .map(|distro| {
                let request = request.clone();
                scope.spawn(move || {
                    if !sessions::search_is_current(generation) {
                        return Vec::new();
                    }
                    let Ok(reply) = run_agent::<Reply>(distro, &["search"], Some(request)) else { return Vec::new() };
                    reply
                        .files
                        .iter()
                        .flat_map(|found| {
                            let id = sessions::session_id_for(found.path.rsplit('/').next().unwrap_or_default());
                            sessions::search_lines(&id, found.lines.iter().map(|l| l.get()), needle)
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
    })
}

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
    let output = run_with_timeout(Command::new("wsl.exe").args(["-d", distro, "-e", "sh", "-c", "printf %s \"$HOME\""]), None, LIST_TIMEOUT)?;
    let home = decode_output(&output.stdout).trim().to_string();
    anyhow::ensure!(home.starts_with('/'), "Couldn't find the home folder in WSL {distro}");
    HOMES.lock().insert(distro.to_string(), home.clone());
    Ok(home)
}

pub fn login_shell(distro: &str) -> String {
    if let Some(shell) = CACHE.lock().distros.get(distro).and_then(|d| d.shell.clone()) {
        return shell;
    }
    login_env(distro);
    CACHE.lock().distros.get(distro).and_then(|d| d.shell.clone()).unwrap_or_else(|| "bash".into())
}

pub fn start(distro: &str) -> anyhow::Result<()> {
    let output = run_with_timeout(Command::new("wsl.exe").args(["-d", distro, "-e", "true"]), None, INDEX_TIMEOUT)?;
    anyhow::ensure!(output.status.success(), "Couldn't start WSL distro {distro}");
    *RUNNING.lock() = None;
    Ok(())
}

pub struct WatchProcess {
    pub child: Child,
    pub stdin: std::process::ChildStdin,
}

pub fn spawn_watch(distro: &str, linux_root: &str) -> anyhow::Result<WatchProcess> {
    let mut command = agent_command(distro, &["watch", linux_root]);
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut child = hidden(&mut command).spawn().context("Couldn't start the WSL file watcher")?;
    let mut stdin = child.stdin.take().context("missing stdin")?;
    stdin.write_all(format!("{}\n", *SCRIPT).as_bytes())?;
    stdin.flush()?;
    Ok(WatchProcess { child, stdin })
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
        assert_eq!(parse_host_path("//wsl.localhost/Debian/tmp/x"), Some(("Debian".into(), "/tmp/x".into())));
        assert_eq!(parse_host_path(r"\\?\UNC\wsl.localhost\Debian\etc"), Some(("Debian".into(), "/etc".into())));
        assert_eq!(parse_host_path(r"\\wsl.localhost\"), None);
        assert_eq!(parse_host_path(r"C:\Users"), None);
        assert_eq!(host_of("Debian", "src/a.rs"), "src/a.rs");
    }

    #[test]
    fn decodes_both_wsl_output_encodings() {
        let utf16: Vec<u8> = "\u{feff}Debian\r\nUbuntu\r\n".encode_utf16().flat_map(u16::to_le_bytes).collect();
        assert_eq!(decode_output(&utf16), "Debian\r\nUbuntu\r\n");
        assert_eq!(decode_output("Debian\nUbuntu\n".as_bytes()), "Debian\nUbuntu\n");
        assert_eq!(decode_output(b""), "");
    }

    #[test]
    #[ignore]
    fn watch_mode_reports_changes_and_exits_with_deck() {
        use std::io::{BufRead, BufReader};
        let sh = |script: &str| Command::new("wsl.exe").args(["-d", "Debian", "-e", "sh", "-c", script]).output().unwrap();
        sh("rm -rf /tmp/deck-watch-test && mkdir -p /tmp/deck-watch-test/sub/node_modules");
        let mut spawned = spawn_watch("Debian", "/tmp/deck-watch-test").unwrap();
        let mut lines = BufReader::new(spawned.child.stdout.take().unwrap()).lines();
        assert!(lines.next().unwrap().unwrap().contains("ready"));
        sh("echo hi > /tmp/deck-watch-test/a.txt; mkdir /tmp/deck-watch-test/new; echo x > /tmp/deck-watch-test/sub/node_modules/skip.js");
        let first = lines.next().unwrap().unwrap();
        assert!(first.contains("/tmp/deck-watch-test/a.txt") && !first.contains("skip.js"), "{first}");
        sh("sleep 0.3; echo y > /tmp/deck-watch-test/new/inner.txt");
        let mut seen = String::new();
        while !seen.contains("inner.txt") {
            seen = lines.next().unwrap().unwrap();
        }
        let process = crate::process::Managed::new(spawned.child);
        drop(process);
        drop(spawned.stdin);
        std::thread::sleep(Duration::from_millis(800));
        let left = sh("pgrep -f 'watc[h] /tmp/deck-watch-test' || true");
        assert!(String::from_utf8_lossy(&left.stdout).trim().is_empty(), "watcher still running");
        sh("rm -rf /tmp/deck-watch-test");
    }

    #[test]
    #[ignore]
    fn probe_real_wsl() {
        let start = Instant::now();
        let result = index();
        println!("wsl sessions={} errors={:?} distros={:?} in {:?}", result.sessions.len(), result.errors, result.distros, start.elapsed());
        let start = Instant::now();
        let again = index();
        println!("warm={} in {:?} live={}", again.sessions.len(), start.elapsed(), live_sessions().len());
    }
}
