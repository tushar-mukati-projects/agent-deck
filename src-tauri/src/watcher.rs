use std::{
    collections::{BTreeSet, HashMap},
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use notify::{EventKind, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FsChange {
    root: String,
    dirs: Vec<String>,
    paths: Vec<String>,
}

#[derive(Default)]
pub struct Watchers {
    roots: Mutex<HashMap<String, notify::RecommendedWatcher>>,
}

const NOISY_DIRS: &[&str] = &[".git", "node_modules", "target", ".next", "__pycache__"];
const MAX_BATCH_WAIT: Duration = Duration::from_secs(1);
const MAX_BATCH_SIZE: usize = 5000;

fn is_noise(path: &Path) -> bool {
    path.components().any(|c| NOISY_DIRS.iter().any(|dir| c.as_os_str() == *dir))
        || path.to_string_lossy().ends_with(".claude-deck-tmp")
}

fn debounced<F>(delay: Duration, on_batch: F) -> mpsc::Sender<PathBuf>
where
    F: Fn(BTreeSet<PathBuf>) + Send + 'static,
{
    let (tx, rx) = mpsc::channel::<PathBuf>();
    thread::spawn(move || {
        while let Ok(first) = rx.recv() {
            let started = Instant::now();
            let mut batch = BTreeSet::from([first]);
            while started.elapsed() < MAX_BATCH_WAIT && batch.len() < MAX_BATCH_SIZE {
                match rx.recv_timeout(delay) {
                    Ok(path) => {
                        batch.insert(path);
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return,
                }
            }
            on_batch(batch);
        }
    });
    tx
}

fn make_watcher(tx: mpsc::Sender<PathBuf>) -> notify::Result<notify::RecommendedWatcher> {
    notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if matches!(event.kind, EventKind::Access(_)) {
            return;
        }
        for path in event.paths {
            if !is_noise(&path) {
                let _ = tx.send(path);
            }
        }
    })
}

impl Watchers {
    pub fn watch(&self, app: AppHandle, root: String) -> anyhow::Result<()> {
        let mut roots = self.roots.lock();
        if roots.contains_key(&root) {
            return Ok(());
        }
        let root_for_events = root.clone();
        let tx = debounced(Duration::from_millis(120), move |paths| {
            let dirs: BTreeSet<String> = paths
                .iter()
                .filter_map(|p| p.parent())
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            let _ = app.emit(
                "fs-change",
                FsChange {
                    root: root_for_events.clone(),
                    dirs: dirs.into_iter().collect(),
                    paths: paths.iter().map(|p| p.to_string_lossy().to_string()).collect(),
                },
            );
        });
        let mut watcher = make_watcher(tx)?;
        watcher.watch(Path::new(&root), RecursiveMode::Recursive)?;
        roots.insert(root, watcher);
        Ok(())
    }

    pub fn unwatch(&self, root: &str) {
        self.roots.lock().remove(root);
    }
}

pub fn watch_claude_home(app: AppHandle) -> Option<notify::RecommendedWatcher> {
    let tx = debounced(Duration::from_millis(700), move |_| {
        let _ = app.emit("sessions-changed", ());
    });
    let mut watcher = make_watcher(tx).ok()?;
    for dir in [crate::sessions::projects_dir(), crate::sessions::live_dir()] {
        let _ = std::fs::create_dir_all(&dir);
        let _ = watcher.watch(&dir, RecursiveMode::Recursive);
    }
    let codex = crate::codex::sessions_dir();
    if codex.is_dir() {
        let _ = watcher.watch(&codex, RecursiveMode::Recursive);
    }
    Some(watcher)
}
