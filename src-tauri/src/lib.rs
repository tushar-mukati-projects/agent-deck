mod agent_config;
mod changes;
mod codex;
mod commands;
mod file_protocol;
mod fsx;
mod git;
mod hide_mode;
mod mcp;
mod notes;
mod phone;
mod pg;
mod pool;
mod process;
mod pty;
mod sessions;
mod tasks;
mod util;
mod watcher;
mod wsl;

use tauri::{Manager, RunEvent};

use mcp::McpManager;
use pg::PgManager;
use pty::PtyManager;
use watcher::Watchers;

const IDLE_SWEEP: std::time::Duration = std::time::Duration::from_secs(60);
const IDLE_LIMIT: std::time::Duration = std::time::Duration::from_secs(15 * 60);

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .register_asynchronous_uri_scheme_protocol(file_protocol::SCHEME, |_ctx, request, responder| {
            tauri::async_runtime::spawn_blocking(move || responder.respond(file_protocol::respond(&request)));
        })
        .manage(PtyManager::default())
        .manage(Watchers::default())
        .manage(McpManager::default())
        .manage(PgManager::default())
        .setup(|app| {
            app.manage(watcher::watch_claude_home(app.handle().clone()));
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(IDLE_SWEEP);
                handle.state::<McpManager>().shutdown_idle(IDLE_LIMIT);
                handle.state::<PgManager>().shutdown_idle(IDLE_LIMIT);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::environment,
            commands::list_sessions,
            commands::list_wsl_sessions,
            commands::wsl_start,
            commands::live_sessions,
            commands::session_transcript,
            commands::subagent_transcript,
            commands::delete_session,
            commands::terminate_live_session,
            commands::rename_session,
            commands::search_sessions,
            commands::session_changes,
            commands::session_backup,
            commands::git_status,
            commands::git_head_file,
            commands::agent_overview,
            commands::remove_agent_config,
            commands::create_memory_file,
            commands::mcp_describe,
            commands::mcp_call,
            commands::mcp_read_resource,
            commands::mcp_disconnect,
            commands::pg_info,
            commands::pg_query,
            commands::pg_cancel,
            commands::pty_spawn,
            commands::pty_attach,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::pty_list,
            commands::list_dir,
            commands::read_file,
            commands::write_file,
            commands::stat_path,
            commands::read_tail,
            commands::session_tasks,
            commands::list_files,
            commands::open_in_editor,
            commands::open_path,
            commands::reveal_path,
            commands::watch_dir,
            commands::unwatch_dir,
            commands::set_attention_badge,
            commands::apply_hide_mode,
            commands::list_notes,
            commands::save_note,
            commands::delete_note,
            commands::notes_folder,
            commands::phone_ping,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Claude Deck");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            handle.state::<PtyManager>().kill_all();
            handle.state::<McpManager>().shutdown_all();
            handle.state::<PgManager>().shutdown_all();
            handle.state::<Watchers>().clear();
        }
    });
}
