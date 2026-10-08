use serde::Serialize;
use tauri::{ipc::Channel, AppHandle, Manager};

use crate::{
    agent_config, changes, fsx, git, hide_mode,
    mcp::{self, McpManager},
    pg::{self, PgManager},
    pty::{self, PtyEvent, PtyInfo, PtyManager, SpawnRequest},
    sessions::{self, LiveSession, Needle, SearchHit, SessionInfo, TranscriptPage},
    tasks,
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

fn on_host<T>(path: &str, wsl: impl FnOnce(&str, &str) -> T, local: impl FnOnce() -> T) -> T {
    match wsl::parse_host_path(path) {
        Some((distro, linux)) => wsl(&distro, &linux),
        None => local(),
    }
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
pub async fn environment() -> CmdResult<Environment> {
    blocking(|| {
        let home = dirs::home_dir().unwrap_or_default();
        Ok(Environment {
            home: home.to_string_lossy().to_string(),
            claude_home: sessions::claude_home().to_string_lossy().to_string(),
            shell: pty::default_shell(),
            claude_found: which::which("claude").is_ok() || home.join(".local").join("bin").join("claude.exe").is_file(),
            codex_found: which::which("codex").is_ok(),
        })
    })
    .await
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
pub async fn session_transcript(file_path: String, distro: Option<String>, from_offset: Option<u64>) -> CmdResult<TranscriptPage> {
    let from = from_offset.unwrap_or(0);
    blocking(move || match distro {
        Some(distro) => wsl::transcript(&distro, &file_path, from),
        None => sessions::transcript(&file_path, from),
    })
    .await
}

#[tauri::command]
pub async fn delete_session(file_path: String, distro: Option<String>) -> CmdResult<()> {
    blocking(move || match distro {
        Some(distro) => wsl::delete_session(&distro, &file_path),
        None => sessions::delete_session(&file_path),
    })
    .await
}

#[tauri::command]
pub async fn terminate_live_session(session_id: String, pid: u32, distro: Option<String>) -> CmdResult<()> {
    blocking(move || match distro {
        Some(distro) => wsl::terminate_session(&distro, &session_id, pid),
        None => sessions::terminate_live(&session_id, pid),
    })
    .await
}

#[tauri::command]
pub async fn rename_session(file_path: String, distro: Option<String>, title: String) -> CmdResult<()> {
    blocking(move || match distro {
        Some(distro) => wsl::rename_session(&distro, &file_path, &title),
        None => sessions::rename_session(&file_path, &title),
    })
    .await
}

#[tauri::command]
pub async fn search_sessions(query: String, include_wsl: bool) -> CmdResult<Vec<SearchHit>> {
    let generation = sessions::begin_search();
    blocking(move || {
        let Some(needle) = Needle::new(&query) else { return Ok(Vec::new()) };
        let (mut hits, wsl_hits) = rayon::join(
            || sessions::search(&needle, generation),
            || if include_wsl { wsl::search(&needle, generation) } else { Vec::new() },
        );
        hits.extend(wsl_hits);
        Ok(if sessions::search_is_current(generation) { hits } else { Vec::new() })
    })
    .await
}

#[tauri::command]
pub async fn session_changes(file_path: String, distro: Option<String>) -> CmdResult<Vec<changes::ChangedFile>> {
    blocking(move || match distro {
        Some(distro) => wsl::session_changes(&distro, &file_path),
        None => changes::session_changes(&file_path),
    })
    .await
}

#[tauri::command]
pub async fn session_backup(file_path: String, backup: String, distro: Option<String>) -> CmdResult<String> {
    blocking(move || match distro {
        Some(distro) => wsl::session_backup(&distro, &file_path, &backup),
        None => changes::session_backup(&file_path, &backup),
    })
    .await
}

#[tauri::command]
pub async fn git_status(root: String) -> CmdResult<Vec<git::GitChange>> {
    blocking(move || on_host(&root, wsl::git_status, || git::status(&root))).await
}

#[tauri::command]
pub async fn git_head_file(path: String) -> CmdResult<String> {
    blocking(move || on_host(&path, wsl::git_head_file, || git::head_file(&path))).await
}

#[tauri::command]
pub async fn agent_overview(cwd: String, agent: agent_config::Agent) -> CmdResult<agent_config::Overview> {
    blocking(move || agent_config::overview(&cwd, agent)).await
}

#[tauri::command]
pub async fn remove_agent_config(app: AppHandle, cwd: String, agent: agent_config::Agent, removal: agent_config::Removal) -> CmdResult<()> {
    let server = match &removal {
        agent_config::Removal::McpServer { id } => Some(id.clone()),
        _ => None,
    };
    blocking(move || {
        agent_config::remove(&cwd, agent, removal)?;
        if let Some(id) = server {
            disconnect_server(&app, &cwd, &id);
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn create_memory_file(path: String) -> CmdResult<()> {
    blocking(move || agent_config::create_memory_file(&path)).await
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

fn disconnect_server(app: &AppHandle, cwd: &str, id: &str) {
    app.state::<McpManager>().disconnect(cwd, id);
    app.state::<PgManager>().disconnect(cwd, id);
}

#[tauri::command]
pub async fn mcp_disconnect(app: AppHandle, cwd: String, id: String) -> CmdResult<()> {
    blocking(move || {
        disconnect_server(&app, &cwd, &id);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn pg_info(app: AppHandle, cwd: String, id: String) -> CmdResult<pg::ConnectionInfo> {
    blocking(move || app.state::<PgManager>().info(&cwd, &id)).await
}

#[tauri::command]
pub async fn pg_query(app: AppHandle, cwd: String, id: String, sql: String) -> CmdResult<pg::QueryOutput> {
    blocking(move || app.state::<PgManager>().query(&cwd, &id, &sql)).await
}

#[tauri::command]
pub async fn pg_cancel(app: AppHandle, cwd: String, id: String) -> CmdResult<()> {
    blocking(move || app.state::<PgManager>().cancel(&cwd, &id)).await
}

#[tauri::command]
pub async fn pty_spawn(app: AppHandle, request: SpawnRequest, on_event: Channel<PtyEvent>) -> CmdResult<PtyInfo> {
    blocking(move || app.state::<PtyManager>().spawn(request, on_event)).await
}

#[tauri::command(async)]
pub fn pty_attach(state: tauri::State<PtyManager>, id: String, on_event: Channel<PtyEvent>) -> CmdResult<PtyInfo> {
    state.attach(&id, on_event).map_err(|e| format!("{e:#}"))
}

#[tauri::command(async)]
pub fn pty_write(state: tauri::State<PtyManager>, id: String, data: String) -> CmdResult<()> {
    state.write(&id, &data).map_err(|e| format!("{e:#}"))
}

#[tauri::command(async)]
pub fn pty_resize(state: tauri::State<PtyManager>, id: String, cols: u16, rows: u16) -> CmdResult<()> {
    state.resize(&id, cols, rows).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn pty_kill(app: AppHandle, id: String) -> CmdResult<()> {
    blocking(move || {
        app.state::<PtyManager>().kill(&id);
        Ok(())
    })
    .await
}

#[tauri::command(async)]
pub fn pty_list(state: tauri::State<PtyManager>) -> Vec<PtyInfo> {
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
pub async fn write_file(
    path: String,
    contents: String,
    encoding: Option<fsx::Encoding>,
    expected_modified_ms: Option<u64>,
) -> CmdResult<fsx::WriteOutcome> {
    blocking(move || fsx::write_file(&path, &contents, encoding, expected_modified_ms)).await
}

#[tauri::command]
pub async fn read_tail(path: String, max_bytes: u64) -> CmdResult<fsx::FileTail> {
    blocking(move || fsx::read_tail(&path, max_bytes)).await
}

#[tauri::command]
pub async fn session_tasks(file_path: String, distro: Option<String>) -> CmdResult<Vec<tasks::AgentTask>> {
    blocking(move || match distro {
        Some(distro) => wsl::session_tasks(&distro, &file_path),
        None => tasks::local(&file_path),
    })
    .await
}

#[tauri::command]
pub async fn stat_path(path: String) -> CmdResult<Option<fsx::PathStat>> {
    blocking(move || fsx::stat_path(&path)).await
}

#[tauri::command]
pub async fn list_files(root: String) -> CmdResult<Vec<String>> {
    blocking(move || on_host(&root, wsl::list_files, || fsx::list_files(&root))).await
}

#[tauri::command]
pub async fn open_in_editor(path: String) -> CmdResult<()> {
    blocking(move || fsx::open_in_editor(&path)).await
}

#[tauri::command]
pub async fn open_path(path: String) -> CmdResult<()> {
    blocking(move || fsx::open_path(&path)).await
}

#[tauri::command]
pub async fn reveal_path(path: String) -> CmdResult<()> {
    blocking(move || fsx::reveal_path(&path)).await
}

#[tauri::command]
pub async fn watch_dir(app: AppHandle, root: String) -> CmdResult<()> {
    blocking(move || app.state::<Watchers>().watch(app.clone(), root)).await
}

#[tauri::command]
pub async fn unwatch_dir(app: AppHandle, root: String) -> CmdResult<()> {
    blocking(move || {
        app.state::<Watchers>().unwatch(&root);
        Ok(())
    })
    .await
}

#[tauri::command]
pub fn set_attention_badge(window: tauri::WebviewWindow, active: bool) -> CmdResult<()> {
    #[cfg(windows)]
    window.set_overlay_icon(active.then(badge_icon)).map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    let _ = (window, active);
    Ok(())
}

#[tauri::command]
pub fn apply_hide_mode(window: tauri::WebviewWindow, enabled: bool) -> CmdResult<Option<String>> {
    hide_mode::apply(&window, enabled).map_err(|e| format!("{e:#}"))
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
