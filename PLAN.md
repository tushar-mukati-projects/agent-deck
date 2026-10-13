# Agent Deck: plan

## How it flows

```
React UI (src)
  │  invoke("command", args)            ▲  events: sessions-changed, fs-change
  ▼                                     │  channels: PTY output, batched
Tauri commands (src-tauri/src/commands.rs)
  ▼
Rust backend modules
  ├─ ConPTY terminals (portable-pty) ── claude / codex / pwsh / wsl.exe
  ├─ session index of ~/.claude and ~/.codex (incremental JSONL parsing)
  ├─ WSL bridge ── wsl.exe ── wsl_agent.py running inside each distro
  ├─ file system, git, file watchers, MCP clients, Postgres
  └─ deckfile: protocol for images and media in the viewer
```

The UI never touches the disk directly. Every read, write, process and network call goes through a Tauri command, and slow work runs off the main thread.

## Folders

**Frontend (`src`)**

- `features/`: one folder per panel: sidebar, titlebar, workspace (agent pane, shells, subagents, previews), viewer, explorer, changes, agent-config, mcp, palette, settings, notes, statusbar, welcome, shortcuts, terminal.
- `stores/`: zustand state for workspaces (persisted), sessions, terminals, explorer, viewer, UI, settings and agent tasks.
- `actions/`: user-level operations (open, resume, fork, close, delete, files, notes, hide mode) shared by every surface.
- `hooks/`: app-wide effects (events, shortcuts, alerts, theme sync, window activity).
- `lib/`: pure logic with tests (sessions, agents, fuzzy search, themes, paths, notes), the typed Tauri command layer in `lib/tauri`, and the xterm registry in `lib/terminal`.
- `components/ui/`: shared buttons, tabs, menus, dialogs and feedback.

**Backend (`src-tauri/src`)**

- `commands.rs`: every Tauri command, as thin wrappers.
- `pty.rs`: ConPTY terminals, reader and sender threads, output batching, replay buffer for reattach.
- `sessions.rs`, `codex.rs`: session index, transcripts, search, rename, delete.
- `wsl.rs`, `wsl_agent.py`: WSL distros, the in-distro index and watcher.
- `tasks.rs`: agent background shells and subagents.
- `changes.rs`, `git.rs`: what changed in a session and in the repo.
- `agent_config/`: what each agent loads (Claude and Codex readers, MCP server resolution, removal, secret masking).
- `mcp.rs`, `pg.rs`, `pool.rs`: MCP clients and the Postgres browser.
- `fsx.rs`, `file_protocol.rs`, `watcher.rs`: files, the media protocol, debounced watchers.
- `notes.rs`, `phone.rs`, `hide_mode.rs`, `process.rs`, `util.rs`, `legacy_data.rs`: notes, phone pings, hide mode, job objects, path guards, and the one-time copy of Claude Deck data.

## Key decisions

- **Terminals live outside React.** xterm instances sit in a registry, so switching tabs never loses scrollback. WebGL rendering is capped at 6 contexts; hidden terminals give theirs up first.
- **Output batching.** A PTY that sends a burst of output is batched for a few milliseconds, so floods arrive as a few hundred messages a second instead of thousands, while single keystroke echoes still go out at once.
- **Incremental indexing.** Session files are parsed from the last byte offset. WSL sessions are indexed by a small Python agent inside the distro, because reading through `\\wsl.localhost` is too slow for large histories.
- **Safe by default.** The media protocol refuses network paths and credential folders. "Open with default app" refuses programs and scripts. MCP secrets never reach the UI, and SQL or MCP calls that change data ask first.
- **Few re-renders.** Store updates keep unchanged objects, so panels only redraw what changed while agents work.
- **Windows only**, built as a per-user NSIS installer.
- **Code style:** no comments in the code; the Rust code is formatted by hand (never `cargo fmt`); TypeScript uses prettier.

## Build and release

1. `npm run check` (typecheck and tests) and, in `src-tauri`, `cargo clippy --all-targets` and `cargo test --lib`.
2. `npm run app:build` writes the installer to `src-tauri\target\release\bundle\nsis`.
3. Check the installer's hash before and after uploading it to a GitHub release.

## What's next

- Sign the installer and add an in-app updater.
- Show more of a running session's state in the tab strip (cost, model, context use).
- A desktop panel that shows what WinPilot is doing for the active session.
- End-to-end UI tests that drive the built app.
