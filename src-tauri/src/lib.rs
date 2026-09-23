mod changes;
mod fsx;
mod pty;
mod sessions;
mod watcher;
mod wsl;

use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager, RunEvent, State};

use pty::{PtyEvent, PtyInfo, PtyManager, SpawnRequest};
use sessions::{LiveSession, SessionInfo, TranscriptItem};
use watcher::Watchers;

type CmdResult<T> = Result<T, String>;

fn err(e: anyhow::Error) -> String {
    format!("{e:#}")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Environment {
    home: String,
    claude_home: String,
    shell: String,
    claude_found: bool,
}

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> anyhow::Result<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|e| e.to_string())?.map_err(err)
}

#[tauri::command]
async fn list_sessions() -> Vec<SessionInfo> {
    tauri::async_runtime::spawn_blocking(sessions::list_sessions).await.unwrap_or_default()
}

#[tauri::command]
async fn list_wsl_sessions() -> CmdResult<wsl::WslIndex> {
    blocking(|| Ok(wsl::index())).await
}

#[tauri::command]
async fn wsl_distros() -> Vec<wsl::Distro> {
    tauri::async_runtime::spawn_blocking(wsl::distros).await.unwrap_or_default()
}

#[tauri::command]
async fn wsl_start(distro: String) -> CmdResult<()> {
    blocking(move || wsl::start(&distro)).await
}

#[tauri::command]
async fn live_sessions() -> Vec<LiveSession> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut live = sessions::live_sessions();
        live.extend(wsl::live_sessions());
        live
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
async fn session_transcript(file_path: String, distro: Option<String>) -> CmdResult<Vec<TranscriptItem>> {
    blocking(move || match distro {
        Some(distro) => wsl::transcript(&distro, &file_path),
        None => sessions::transcript(&file_path),
    })
    .await
}

#[tauri::command]
async fn delete_session(file_path: String, distro: Option<String>) -> CmdResult<()> {
    blocking(move || match distro {
        Some(distro) => wsl::delete_session(&distro, &file_path),
        None => sessions::delete_session(&file_path),
    })
    .await
}

#[tauri::command]
async fn session_changes(file_path: String, distro: Option<String>) -> CmdResult<Vec<changes::ChangedFile>> {
    blocking(move || match distro {
        Some(distro) => wsl::session_changes(&distro, &file_path),
        None => changes::session_changes(&file_path),
    })
    .await
}

#[tauri::command]
async fn session_backup(file_path: String, backup: String, distro: Option<String>) -> CmdResult<String> {
    blocking(move || match distro {
        Some(distro) => wsl::session_backup(&distro, &file_path, &backup),
        None => changes::session_backup(&file_path, &backup),
    })
    .await
}

#[tauri::command]
async fn git_status(root: String) -> CmdResult<Vec<changes::GitChange>> {
    blocking(move || match wsl::parse_host_path(&root) {
        Some((distro, linux_root)) => wsl::git_status(&distro, &linux_root),
        None => changes::git_status(&root),
    })
    .await
}

#[tauri::command]
async fn git_head_file(path: String) -> CmdResult<String> {
    blocking(move || match wsl::parse_host_path(&path) {
        Some((distro, linux_path)) => wsl::git_head_file(&distro, &linux_path),
        None => changes::git_head_file(&path),
    })
    .await
}

#[tauri::command]
async fn rename_session(file_path: String, distro: Option<String>, title: String) -> CmdResult<()> {
    blocking(move || match distro {
        Some(distro) => wsl::rename_session(&distro, &file_path, &title),
        None => changes::rename_session(&file_path, &title),
    })
    .await
}

fn badge_icon() -> tauri::image::Image<'static> {
    const SIZE: u32 = 32;
    let mut rgba = Vec::with_capacity((SIZE * SIZE * 4) as usize);
    let center = (SIZE as f32 - 1.0) / 2.0;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let distance = ((x as f32 - center).powi(2) + (y as f32 - center).powi(2)).sqrt();
            let alpha = (center - distance + 0.5).clamp(0.0, 1.0);
            let ring = distance > center - 3.0;
            let (r, g, b) = if ring { (18, 19, 23) } else { (226, 122, 85) };
            rgba.extend_from_slice(&[r, g, b, (alpha * 255.0) as u8]);
        }
    }
    tauri::image::Image::new_owned(rgba, SIZE, SIZE)
}

#[tauri::command]
fn set_attention_badge(window: tauri::WebviewWindow, active: bool) -> CmdResult<()> {
    #[cfg(windows)]
    window.set_overlay_icon(active.then(badge_icon)).map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    let _ = (window, active);
    Ok(())
}

#[tauri::command]
fn environment() -> Environment {
    let home = dirs::home_dir().unwrap_or_default();
    Environment {
        home: home.to_string_lossy().to_string(),
        claude_home: sessions::claude_home().to_string_lossy().to_string(),
        shell: pty::default_shell(),
        claude_found: which::which("claude").is_ok() || home.join(".local").join("bin").join("claude.exe").is_file(),
    }
}

#[tauri::command]
fn pty_spawn(state: State<PtyManager>, request: SpawnRequest, on_event: Channel<PtyEvent>) -> CmdResult<PtyInfo> {
    state.spawn(request, on_event).map_err(err)
}

#[tauri::command]
fn pty_attach(state: State<PtyManager>, id: String, on_event: Channel<PtyEvent>) -> CmdResult<PtyInfo> {
    state.attach(&id, on_event).map_err(err)
}

#[tauri::command]
fn pty_write(state: State<PtyManager>, id: String, data: String) -> CmdResult<()> {
    state.write(&id, &data).map_err(err)
}

#[tauri::command]
fn pty_resize(state: State<PtyManager>, id: String, cols: u16, rows: u16) -> CmdResult<()> {
    state.resize(&id, cols, rows).map_err(err)
}

#[tauri::command]
fn pty_kill(state: State<PtyManager>, id: String) -> CmdResult<()> {
    state.kill(&id).map_err(err)
}

#[tauri::command]
fn pty_list(state: State<PtyManager>) -> Vec<PtyInfo> {
    state.list()
}

#[tauri::command]
async fn list_dir(path: String) -> CmdResult<Vec<fsx::DirEntry>> {
    tauri::async_runtime::spawn_blocking(move || fsx::list_dir(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

#[tauri::command]
async fn read_file(path: String) -> CmdResult<fsx::FileContent> {
    tauri::async_runtime::spawn_blocking(move || fsx::read_file(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

#[tauri::command]
async fn write_file(path: String, contents: String) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || fsx::write_file(&path, &contents))
        .await
        .map_err(|e| e.to_string())?
        .map_err(err)
}

#[tauri::command]
async fn list_files(root: String) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || match wsl::parse_host_path(&root) {
        Some((distro, linux_root)) => wsl::list_files(&distro, &linux_root).unwrap_or_default(),
        None => fsx::list_files(&root),
    })
    .await
    .unwrap_or_default()
}

#[tauri::command]
fn path_is_dir(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[tauri::command]
fn open_in_editor(path: String) -> CmdResult<()> {
    fsx::open_in_editor(&path).map_err(err)
}

#[tauri::command]
fn watch_dir(app: AppHandle, state: State<Watchers>, root: String) -> CmdResult<()> {
    state.watch(app, root).map_err(err)
}

#[tauri::command]
fn unwatch_dir(state: State<Watchers>, root: String) {
    state.unwatch(&root);
}

struct ClaudeHomeWatcher(#[allow(dead_code)] Option<notify::RecommendedWatcher>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(PtyManager::default())
        .manage(Watchers::default())
        .setup(|app| {
            app.manage(ClaudeHomeWatcher(watcher::watch_claude_home(app.handle().clone())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_sessions,
            list_wsl_sessions,
            wsl_distros,
            wsl_start,
            live_sessions,
            session_transcript,
            delete_session,
            session_changes,
            session_backup,
            git_status,
            git_head_file,
            rename_session,
            set_attention_badge,
            environment,
            pty_spawn,
            pty_attach,
            pty_write,
            pty_resize,
            pty_kill,
            pty_list,
            list_dir,
            read_file,
            write_file,
            list_files,
            path_is_dir,
            open_in_editor,
            watch_dir,
            unwatch_dir,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Claude Deck");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            handle.state::<PtyManager>().kill_all();
        }
    });
}
