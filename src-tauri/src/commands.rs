use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager, State};

use crate::{
    changes, claude_config, fsx, git,
    mcp::{self, McpManager},
    pg::{self, PgManager},
    pty::{self, PtyEvent, PtyInfo, PtyManager, SpawnRequest},
    sessions::{self, LiveSession, SearchHit, SessionInfo, TranscriptItem},
    watcher::Watchers,
    wsl,
};

type CmdResult<T> = Result<T, String>;

async fn blocking<T: Send + 'static>(work: impl FnOnce() -> anyhow::Result<T> + Send + 'static) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

macro_rules! local_or_wsl {
    ($distro:expr, |$d:ident| $wsl:expr, $local:expr) => {
        match $distro {
            Some($d) => $wsl,
            None => $local,
        }
    };
}

macro_rules! host_path {
    ($path:expr, |$d:ident, $linux:ident| $wsl:expr, $local:expr) => {
        match wsl::parse_host_path(&$path) {
            Some(($d, $linux)) => $wsl,
            None => $local,
        }
    };
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    home: String,
    claude_home: String,
    shell: String,
    claude_found: bool,
    codex_found: bool,
}

#[tauri::command]
pub fn environment() -> Environment {
    let home = dirs::home_dir().unwrap_or_default();
    Environment {
        home: home.to_string_lossy().to_string(),
        claude_home: sessions::claude_home().to_string_lossy().to_string(),
        shell: pty::default_shell(),
        claude_found: which::which("claude").is_ok() || home.join(".local").join("bin").join("claude.exe").is_file(),
        codex_found: which::which("codex").is_ok(),
    }
}

#[tauri::command]
pub async fn list_sessions() -> CmdResult<Vec<SessionInfo>> {
    blocking(|| Ok(sessions::list_sessions())).await
}

#[tauri::command]
pub async fn list_wsl_sessions() -> CmdResult<wsl::WslIndex> {
    blocking(|| Ok(wsl::index())).await
}

#[tauri::command]
pub async fn wsl_distros() -> CmdResult<Vec<wsl::Distro>> {
    blocking(|| Ok(wsl::distros())).await
}

#[tauri::command]
pub async fn wsl_start(distro: String) -> CmdResult<()> {
    blocking(move || wsl::start(&distro)).await
}

#[tauri::command]
pub async fn live_sessions() -> CmdResult<Vec<LiveSession>> {
    blocking(|| {
        let mut live = sessions::live_sessions();
        live.extend(wsl::live_sessions());
        Ok(live)
    })
    .await
}

#[tauri::command]
pub async fn session_transcript(file_path: String, distro: Option<String>) -> CmdResult<Vec<TranscriptItem>> {
    blocking(move || local_or_wsl!(distro, |d| wsl::transcript(&d, &file_path), sessions::transcript(&file_path))).await
}

#[tauri::command]
pub async fn delete_session(file_path: String, distro: Option<String>) -> CmdResult<()> {
    blocking(move || local_or_wsl!(distro, |d| wsl::delete_session(&d, &file_path), sessions::delete_session(&file_path)))
        .await
}

#[tauri::command]
pub async fn rename_session(file_path: String, distro: Option<String>, title: String) -> CmdResult<()> {
    blocking(move || {
        local_or_wsl!(distro, |d| wsl::rename_session(&d, &file_path, &title), sessions::rename_session(&file_path, &title))
    })
    .await
}

#[tauri::command]
pub async fn search_sessions(query: String, include_wsl: bool) -> CmdResult<Vec<SearchHit>> {
    blocking(move || {
        let mut hits = sessions::search(&query);
        if include_wsl {
            hits.extend(wsl::search(&query));
        }
        Ok(hits)
    })
    .await
}

#[tauri::command]
pub async fn session_changes(file_path: String, distro: Option<String>) -> CmdResult<Vec<changes::ChangedFile>> {
    blocking(move || local_or_wsl!(distro, |d| wsl::session_changes(&d, &file_path), changes::session_changes(&file_path)))
        .await
}

#[tauri::command]
pub async fn session_backup(file_path: String, backup: String, distro: Option<String>) -> CmdResult<String> {
    blocking(move || {
        local_or_wsl!(distro, |d| wsl::session_backup(&d, &file_path, &backup), changes::session_backup(&file_path, &backup))
    })
    .await
}

#[tauri::command]
pub async fn git_status(root: String) -> CmdResult<Vec<git::GitChange>> {
    blocking(move || host_path!(root, |d, linux| wsl::git_status(&d, &linux), git::status(&root))).await
}

#[tauri::command]
pub async fn git_head_file(path: String) -> CmdResult<String> {
    blocking(move || host_path!(path, |d, linux| wsl::git_head_file(&d, &linux), git::head_file(&path))).await
}

#[tauri::command]
pub async fn claude_overview(cwd: String) -> CmdResult<claude_config::Overview> {
    blocking(move || claude_config::overview(&cwd)).await
}

#[tauri::command]
pub async fn create_memory_file(path: String) -> CmdResult<()> {
    blocking(move || claude_config::create_memory_file(&path)).await
}

#[tauri::command]
pub async fn mcp_describe(app: AppHandle, cwd: String, id: String) -> CmdResult<mcp::Description> {
    blocking(move || app.state::<McpManager>().describe(&cwd, &id)).await
}

#[tauri::command]
pub async fn mcp_call(app: AppHandle, cwd: String, id: String, tool: String, arguments: serde_json::Value) -> CmdResult<serde_json::Value> {
    blocking(move || app.state::<McpManager>().call(&cwd, &id, &tool, arguments)).await
}

#[tauri::command]
pub async fn mcp_read_resource(app: AppHandle, cwd: String, id: String, uri: String) -> CmdResult<serde_json::Value> {
    blocking(move || app.state::<McpManager>().read_resource(&cwd, &id, &uri)).await
}

#[tauri::command]
pub fn mcp_disconnect(state: State<McpManager>, cwd: String, id: String) {
    state.disconnect(&cwd, &id);
}

#[tauri::command]
pub async fn pg_info(app: AppHandle, cwd: String, id: String) -> CmdResult<pg::ConnectionInfo> {
    blocking(move || app.state::<PgManager>().info(&cwd, &id)).await
}

#[tauri::command]
pub async fn pg_query(app: AppHandle, cwd: String, id: String, sql: String) -> CmdResult<pg::QueryOutput> {
    blocking(move || {
        let pg = app.state::<PgManager>();
        pg.query(&cwd, &id, &sql).or_else(|first| {
            if first.to_string().contains("closed") || first.to_string().contains("connection") {
                pg.disconnect(&cwd, &id);
                pg.query(&cwd, &id, &sql)
            } else {
                Err(first)
            }
        })
    })
    .await
}

#[tauri::command(async)]
pub fn pty_spawn(state: State<PtyManager>, request: SpawnRequest, on_event: Channel<PtyEvent>) -> CmdResult<PtyInfo> {
    state.spawn(request, on_event).map_err(|e| format!("{e:#}"))
}

#[tauri::command(async)]
pub fn pty_attach(state: State<PtyManager>, id: String, on_event: Channel<PtyEvent>) -> CmdResult<PtyInfo> {
    state.attach(&id, on_event).map_err(|e| format!("{e:#}"))
}

#[tauri::command(async)]
pub fn pty_write(state: State<PtyManager>, id: String, data: String) -> CmdResult<()> {
    state.write(&id, &data).map_err(|e| format!("{e:#}"))
}

#[tauri::command(async)]
pub fn pty_resize(state: State<PtyManager>, id: String, cols: u16, rows: u16) -> CmdResult<()> {
    state.resize(&id, cols, rows).map_err(|e| format!("{e:#}"))
}

#[tauri::command(async)]
pub fn pty_kill(state: State<PtyManager>, id: String) {
    state.kill(&id);
}

#[tauri::command(async)]
pub fn pty_list(state: State<PtyManager>) -> Vec<PtyInfo> {
    state.list()
}

#[tauri::command]
pub async fn list_dir(path: String) -> CmdResult<Vec<fsx::DirEntry>> {
    blocking(move || fsx::list_dir(&path)).await
}

#[tauri::command]
pub async fn read_file(path: String) -> CmdResult<fsx::FileContent> {
    blocking(move || fsx::read_file(&path)).await
}

#[tauri::command]
pub async fn write_file(path: String, contents: String) -> CmdResult<()> {
    blocking(move || fsx::write_file(&path, &contents)).await
}

#[tauri::command]
pub async fn list_files(root: String) -> CmdResult<Vec<String>> {
    blocking(move || host_path!(root, |d, linux| wsl::list_files(&d, &linux), Ok(fsx::list_files(&root)))).await
}

#[tauri::command]
pub async fn path_is_dir(path: String) -> CmdResult<bool> {
    blocking(move || Ok(std::path::Path::new(&path).is_dir())).await
}

#[tauri::command]
pub async fn open_in_editor(path: String) -> CmdResult<()> {
    blocking(move || fsx::open_in_editor(&path)).await
}

#[tauri::command(async)]
pub fn watch_dir(app: AppHandle, state: State<Watchers>, root: String) -> CmdResult<()> {
    state.watch(app, root).map_err(|e| format!("{e:#}"))
}

#[tauri::command(async)]
pub fn unwatch_dir(state: State<Watchers>, root: String) {
    state.unwatch(&root);
}

#[tauri::command]
pub fn set_attention_badge(window: tauri::WebviewWindow, active: bool) -> CmdResult<()> {
    #[cfg(windows)]
    window.set_overlay_icon(active.then(badge_icon)).map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    let _ = (window, active);
    Ok(())
}

#[cfg(windows)]
fn badge_icon() -> tauri::image::Image<'static> {
    const SIZE: u32 = 32;
    let center = (SIZE as f32 - 1.0) / 2.0;
    let rgba = (0..SIZE * SIZE)
        .flat_map(|i| {
            let (x, y) = ((i % SIZE) as f32, (i / SIZE) as f32);
            let distance = ((x - center).powi(2) + (y - center).powi(2)).sqrt();
            let alpha = ((center - distance + 0.5).clamp(0.0, 1.0) * 255.0) as u8;
            let (r, g, b) = if distance > center - 3.0 { (18, 19, 23) } else { (226, 122, 85) };
            [r, g, b, alpha]
        })
        .collect();
    tauri::image::Image::new_owned(rgba, SIZE, SIZE)
}
