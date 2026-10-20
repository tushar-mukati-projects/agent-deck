use std::{
    collections::{BTreeSet, HashMap},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::ChildStdin,
    sync::{mpsc, Arc},
    thread,
    time::{Duration, Instant},
};

use notify::{EventKind, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::{process::Managed, util::check_remote, wsl};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FsChange {
    root: String,
    dirs: Vec<String>,
    paths: Vec<String>,
    rescan: bool,
}

enum Signal {
    Path(PathBuf),
    Rescan,
}

struct WslWatch {
    process: Managed,
    _stdin: ChildStdin,
}

enum WatchHandle {
    Native { _watcher: notify::RecommendedWatcher },
    Wsl(WslWatch),
}

impl WatchHandle {
    fn reusable(&self) -> bool {
        match self {
            WatchHandle::Native { .. } => false,
            WatchHandle::Wsl(watch) => watch.process.running(),
        }
    }
}

#[derive(Default)]
pub struct Watchers {
    roots: Mutex<HashMap<String, WatchHandle>>,
}

const NOISY_DIRS: &[&str] = &[".git", "node_modules", "target", ".next", "__pycache__"];
const MAX_BATCH_WAIT: Duration = Duration::from_secs(1);
const MAX_BATCH_SIZE: usize = 5000;
const ROOT_DEBOUNCE: Duration = Duration::from_millis(120);
const HOME_DEBOUNCE: Duration = Duration::from_millis(700);
const CODEX_RETRY: Duration = Duration::from_secs(30);

fn is_noise(roots: &[PathBuf], path: &Path) -> bool {
    let below = roots.iter().find_map(|root| path.strip_prefix(root).ok()).unwrap_or(path);
    below.components().any(|c| NOISY_DIRS.iter().any(|dir| c.as_os_str() == *dir))
        || path.to_string_lossy().ends_with(".agent-deck-tmp")
}

fn debounced<F>(delay: Duration, on_batch: F) -> mpsc::Sender<Signal>
where
    F: Fn(BTreeSet<PathBuf>, bool) + Send + 'static,
{
    let (tx, rx) = mpsc::channel::<Signal>();
    thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let started = Instant::now();
            let mut batch = BTreeSet::new();
            let mut rescan = false;
            let mut add = |signal: Signal| match signal {
                Signal::Path(_) if batch.len() >= MAX_BATCH_SIZE => rescan = true,
                Signal::Path(path) => {
                    batch.insert(path);
                }
                Signal::Rescan => rescan = true,
            };
            add(first);
            while started.elapsed() < MAX_BATCH_WAIT {
                match rx.recv_timeout(delay) {
                    Ok(signal) => add(signal),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            let rescan = rescan || batch.len() >= MAX_BATCH_SIZE;
            on_batch(if rescan { BTreeSet::new() } else { batch }, rescan);
        }
    });
    tx
}

fn make_watcher(tx: mpsc::Sender<Signal>, roots: Vec<PathBuf>) -> notify::Result<notify::RecommendedWatcher> {
    notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else {
            let _ = tx.send(Signal::Rescan);
            return;
        };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        if event.need_rescan() {
            let _ = tx.send(Signal::Rescan);
        }
        for path in event.paths.into_iter().filter(|p| !is_noise(&roots, p)) {
            let _ = tx.send(Signal::Path(path));
        }
    })
}

fn root_emitter(app: AppHandle, root: String) -> mpsc::Sender<Signal> {
    debounced(ROOT_DEBOUNCE, move |paths, rescan| {
        let dirs: BTreeSet<String> = paths.iter().filter_map(|p| p.parent()).map(|p| p.to_string_lossy().to_string()).collect();
        let _ = app.emit(
            "fs-change",
            FsChange {
                root: root.clone(),
                dirs: dirs.into_iter().collect(),
                paths: paths.iter().map(|p| p.to_string_lossy().to_string()).collect(),
                rescan,
            },
        );
    })
}

#[derive(Deserialize)]
struct WslMessage {
    #[serde(default)]
    paths: Vec<String>,
    #[serde(default)]
    rescan: bool,
}

fn start_wsl(tx: mpsc::Sender<Signal>, distro: &str, linux_root: &str) -> anyhow::Result<WslWatch> {
    let mut spawned = wsl::spawn_watch(distro, linux_root)?;
    let stdout = spawned.child.stdout.take();
    let process = Managed::new(spawned.child)?;
    let distro = distro.to_string();
    if let Some(stdout) = stdout {
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(message) = serde_json::from_str::<WslMessage>(&line) else { continue };
                if message.rescan {
                    let _ = tx.send(Signal::Rescan);
                }
                for path in message.paths {
                    let _ = tx.send(Signal::Path(PathBuf::from(wsl::host_path(&distro, &path))));
                }
            }
        });
    }
    Ok(WslWatch { process, _stdin: spawned.stdin })
}

impl Watchers {
    pub fn watch(&self, app: AppHandle, root: String) -> anyhow::Result<()> {
        check_remote(Path::new(&root))?;
        if self.roots.lock().get(&root).is_some_and(WatchHandle::reusable) {
            return Ok(());
        }
        let tx = root_emitter(app, root.clone());
        let handle = match wsl::parse_host_path(&root) {
            Some((distro, linux)) => WatchHandle::Wsl(start_wsl(tx, &distro, &linux)?),
            None => {
                let mut watcher = make_watcher(tx, vec![PathBuf::from(&root)])?;
                watcher.watch(Path::new(&root), RecursiveMode::Recursive)?;
                WatchHandle::Native { _watcher: watcher }
            }
        };
        let replaced = self.roots.lock().insert(root, handle);
        drop(replaced);
        Ok(())
    }

    pub fn unwatch(&self, root: &str) {
        let removed = self.roots.lock().remove(root);
        drop(removed);
    }

    pub fn clear(&self) {
        let removed: Vec<_> = self.roots.lock().drain().collect();
        drop(removed);
    }
}

pub(crate) struct HomeWatcher {
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

pub(crate) fn watch_claude_home(app: AppHandle) -> Arc<HomeWatcher> {
    let tx = debounced(HOME_DEBOUNCE, move |_, _| {
        let _ = app.emit("sessions-changed", ());
    });
    let dirs = [crate::sessions::projects_dir(), crate::sessions::live_dir()];
    let roots = dirs.iter().cloned().chain([crate::codex::sessions_dir()]).collect();
    let mut watcher = make_watcher(tx, roots).ok();
    if let Some(watcher) = watcher.as_mut() {
        for dir in dirs {
            let _ = std::fs::create_dir_all(&dir);
            let _ = watcher.watch(&dir, RecursiveMode::Recursive);
        }
    }
    let home = Arc::new(HomeWatcher { watcher: Mutex::new(watcher) });
    let weak = Arc::downgrade(&home);
    thread::spawn(move || loop {
        let codex = crate::codex::sessions_dir();
        let Some(home) = weak.upgrade() else { return };
        if codex.is_dir() {
            if let Some(watcher) = home.watcher.lock().as_mut() {
                let _ = watcher.watch(&codex, RecursiveMode::Recursive);
            }
            return;
        }
        drop(home);
        thread::sleep(CODEX_RETRY);
    });
    home
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batches_paths_and_escalates_floods_to_rescan() {
        let (out_tx, out_rx) = mpsc::channel();
        let tx = debounced(Duration::from_millis(20), move |paths, rescan| {
            let _ = out_tx.send((paths.len(), rescan));
        });
        tx.send(Signal::Path("a".into())).unwrap();
        tx.send(Signal::Path("a".into())).unwrap();
        tx.send(Signal::Path("b".into())).unwrap();
        assert_eq!(out_rx.recv_timeout(Duration::from_secs(2)).unwrap(), (2, false));
        for i in 0..MAX_BATCH_SIZE {
            tx.send(Signal::Path(format!("f{i}").into())).unwrap();
        }
        assert_eq!(out_rx.recv_timeout(Duration::from_secs(3)).unwrap(), (0, true));
        tx.send(Signal::Rescan).unwrap();
        assert_eq!(out_rx.recv_timeout(Duration::from_secs(2)).unwrap(), (0, true));
    }

    #[test]
    fn ignores_noise_below_the_watched_root() {
        const CASES: &[(&str, &str, bool)] = &[
            (r"C:\w", r"C:\w\node_modules\x\index.js", true),
            (r"C:\w", r"C:\w\.a.txt.agent-deck-tmp", true),
            (r"C:\w", r"C:\w\src\main.rs", false),
            (r"C:\repo\target\app", r"C:\repo\target\app\src\main.rs", false),
            (r"C:\repo\.git\app", r"C:\repo\.git\app\README.md", false),
            (r"C:\repo\target\app", r"C:\repo\target\app\target\debug\app.exe", true),
            (r"C:\repo\node_modules\pkg", r"C:\repo\node_modules\pkg\.next\cache", true),
        ];
        for (root, path, noise) in CASES {
            assert_eq!(is_noise(&[PathBuf::from(root)], Path::new(path)), *noise, "root: {root}, path: {path}");
        }
    }
}
