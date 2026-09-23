mod changes;
mod claude_config;
mod commands;
mod fsx;
mod git;
mod mcp;
mod pg;
mod pty;
mod sessions;
mod util;
mod watcher;
mod wsl;

use tauri::{Manager, RunEvent};

use mcp::McpManager;
use pg::PgManager;
use pty::PtyManager;
use watcher::Watchers;

struct ClaudeHomeWatcher(#[allow(dead_code)] Option<notify::RecommendedWatcher>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(PtyManager::default())
        .manage(Watchers::default())
        .manage(McpManager::default())
        .manage(PgManager::default())
        .setup(|app| {
            app.manage(ClaudeHomeWatcher(watcher::watch_claude_home(app.handle().clone())));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::environment,
            commands::list_sessions,
            commands::list_wsl_sessions,
            commands::wsl_distros,
            commands::wsl_start,
            commands::live_sessions,
            commands::session_transcript,
            commands::delete_session,
            commands::rename_session,
            commands::search_sessions,
            commands::session_changes,
            commands::session_backup,
            commands::git_status,
            commands::git_head_file,
            commands::claude_overview,
            commands::create_memory_file,
            commands::mcp_describe,
            commands::mcp_call,
            commands::mcp_read_resource,
            commands::mcp_disconnect,
            commands::pg_info,
            commands::pg_query,
            commands::pty_spawn,
            commands::pty_attach,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::pty_list,
            commands::list_dir,
            commands::read_file,
            commands::write_file,
            commands::list_files,
            commands::path_is_dir,
            commands::open_in_editor,
            commands::watch_dir,
            commands::unwatch_dir,
            commands::set_attention_badge,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Claude Deck");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            handle.state::<PtyManager>().kill_all();
            handle.state::<McpManager>().shutdown_all();
        }
    });
}
