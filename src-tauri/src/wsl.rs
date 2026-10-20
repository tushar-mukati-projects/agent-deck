mod paths;
mod runner;

use std::{
    collections::{HashMap, HashSet},
    io::Write,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::LazyLock,
    thread,
    time::{Duration, Instant},
};

use anyhow::{anyhow, Context};
use base64::Engine;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, value::RawValue, Value};

use crate::{
    changes::ChangedFile,
    git::GitChange,
    sessions::{self, Accumulator, LiveSession, Needle, SearchHit, SessionInfo, TranscriptPage},
    tasks,
    util::{hidden, run_with_timeout},
};
use paths::host_of;
pub(crate) use paths::{host_path, normalize_path, parse_host_path};
use runner::{agent_command, known_login_env, run_agent, run_agent_with};
pub(crate) use runner::{decode_output, env_var, login_command, login_var};

const AGENT: &str = include_str!("wsl_agent.py");
const INDEX_TIMEOUT: Duration = Duration::from_secs(90);
const INDEX_ROUNDS: Duration = Duration::from_secs(60);
const LIST_TIMEOUT: Duration = Duration::from_secs(8);
const RUNNING_TTL: Duration = Duration::from_secs(5);
const LIVE_TTL: Duration = Duration::from_secs(30);
const CACHE_DIR: &str = "agent-deck";

static SCRIPT: LazyLock<String> = LazyLock::new(|| base64::engine::general_purpose::STANDARD.encode(AGENT));

#[derive(Serialize)]
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

#[derive(Serialize, Deserialize)]
struct Cache {
    version: u32,
    distros: HashMap<String, DistroCache>,
}

static CACHE: LazyLock<Mutex<Cache>> = LazyLock::new(|| Mutex::new(load_cache()));
static SAVE_LOCK: Mutex<()> = Mutex::new(());
static INDEX_LOCK: Mutex<()> = Mutex::new(());
static RUNNING: Mutex<Option<(Instant, Vec<String>)>> = Mutex::new(None);
static HOMES: LazyLock<Mutex<HashMap<String, String>>> = LazyLock::new(Mutex::default);

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
    more: bool,
}

#[derive(Deserialize)]
struct Lines {
    lines: Vec<Box<RawValue>>,
    start: u64,
    end: u64,
}

fn cache_file() -> PathBuf {
    dirs::cache_dir().unwrap_or_else(std::env::temp_dir).join(CACHE_DIR).join("wsl-index.json")
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

fn distros() -> Vec<Distro> {
    let running = running_names(true);
    distro_names(false).into_iter().map(|name| Distro { running: running.contains(&name), name }).collect()
}

pub fn is_running(distro: &str) -> bool {
    running_names(false).iter().any(|name| name == distro)
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
                let id = sessions::session_id_of(&change.path);
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
    let (changed, errors) = index_running(&running);
    let mut sessions = cached_sessions(&running, &errors);
    if changed {
        save();
    }
    sessions.sort_by_key(|s| std::cmp::Reverse(s.modified_ms));
    WslIndex { sessions, errors, distros }
}

fn index_running(running: &[String]) -> (bool, HashMap<String, String>) {
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
    (changed, errors)
}

fn cached_sessions(running: &[String], errors: &HashMap<String, String>) -> Vec<SessionInfo> {
    let mut cache = CACHE.lock();
    for (name, state) in cache.distros.iter_mut() {
        if !running.contains(name) || errors.contains_key(name) {
            state.live.clear();
            state.live_at = None;
        }
    }
    let mut sessions = Vec::new();
    for distro in running {
        let Some(state) = cache.distros.get(distro) else { continue };
        sessions.extend(state.entries.iter().filter_map(|(path, entry)| session_info(distro, path, entry)));
    }
    sessions
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

pub fn session_tasks(distro: &str, path: &str) -> anyhow::Result<tasks::SessionTasks> {
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
    let found = log.snapshot();
    tasks::put(&key, log);
    Ok(tasks::SessionTasks {
        shells: found
            .shells
            .into_iter()
            .map(|task| tasks::AgentTask { output_path: task.output_path.as_deref().map(|p| host_of(distro, p)), ..task })
            .collect(),
        agents: found.agents,
    })
}

fn page(reply: Lines, sidechain: bool) -> TranscriptPage {
    TranscriptPage {
        items: sessions::transcript_from_lines(reply.lines.iter().map(|l| l.get()), sidechain),
        offset: reply.end,
        reset: reply.start == 0,
    }
}

pub fn transcript(distro: &str, path: &str, from_offset: u64) -> anyhow::Result<TranscriptPage> {
    Ok(page(run_agent(distro, &["transcript", path, &from_offset.to_string()], None)?, false))
}

pub fn subagent_transcript(distro: &str, path: &str, id: &str, from_offset: u64) -> anyhow::Result<TranscriptPage> {
    anyhow::ensure!(sessions::is_agent_id(id), "not a subagent id");
    Ok(page(run_agent(distro, &["subagent", path, id, &from_offset.to_string()], None)?, true))
}

pub fn delete_session(distro: &str, path: &str) -> anyhow::Result<()> {
    let session_id = sessions::session_id_of(path);
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

pub fn terminate_session(distro: &str, session_id: &str, pid: u32) -> anyhow::Result<()> {
    let _: Value = run_agent(distro, &["terminate", session_id, &pid.to_string()], None)?;
    if let Some(state) = CACHE.lock().distros.get_mut(distro) {
        state.live.retain(|l| l.pid != pid);
    }
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
                            let id = sessions::session_id_of(&found.path);
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

pub fn start(distro: &str) -> anyhow::Result<()> {
    let output = run_with_timeout(Command::new("wsl.exe").args(["-d", distro, "-e", "true"]), None, INDEX_TIMEOUT)?;
    anyhow::ensure!(output.status.success(), "Couldn't start WSL distro {distro}");
    *RUNNING.lock() = None;
    Ok(())
}

pub(crate) struct WatchProcess {
    pub(crate) child: Child,
    pub(crate) stdin: std::process::ChildStdin,
}

pub(crate) fn spawn_watch(distro: &str, linux_root: &str) -> anyhow::Result<WatchProcess> {
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
        let process = crate::process::Managed::new(spawned.child).unwrap();
        drop(process);
        drop(spawned.stdin);
        std::thread::sleep(Duration::from_millis(800));
        let left = sh("pgrep -f 'watc[h] /tmp/deck-watch-test' || true");
        assert!(String::from_utf8_lossy(&left.stdout).trim().is_empty(), "watcher still running");
        sh("rm -rf /tmp/deck-watch-test");
    }
}
