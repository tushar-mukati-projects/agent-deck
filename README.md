# Agent Deck

A fast desktop home for every Claude Code session on this machine — browse, preview, resume, fork and run them side by side, each with its own shells and a live file explorer.

Built with **Tauri 2** (Rust backend, system WebView2) + **React 19 / TypeScript / Tailwind v4** + **xterm.js** (WebGL).

## Features

- **Claude, Codex and any other agent** — Codex sessions (`~/.codex/sessions`, on Windows and inside WSL) are listed, previewed, searched and resumed/forked (`codex resume|fork <id>`) next to Claude sessions, with a Codex badge and an agent filter. New sessions can use Claude, Codex, or any CLI you add in Settings → Other agents (Gemini, Aider, OpenCode…). Pick the default agent in Settings.
- **Tree follows the open file** — switching or opening a file expands the Files tree to it; paste any path (Windows, WSL/Linux, relative, `file.ts:12`) into search to open it.
- **Readable themes** — every theme is checked against minimum contrast (text, borders, status colors, syntax); light themes also raise terminal contrast so any CLI stays legible.
- **Layout** — sessions (all folders) on the left; the open session in the middle; on the right a session panel with **Files / Changes / Agent** (the tab is named after the session's agent) that always follows the active session. Both side panels resize and collapse (`Ctrl+Shift+B` / `Ctrl+Alt+B`).
- **All sessions, every folder** — indexes `~/.claude/projects/**/*.jsonl` (incrementally, by byte offset), grouped by real working folder. Filter to one folder (with or without subfolders) or browse to any folder.
- **Preview before resuming** — read a conversation (markdown rendered, tool calls summarized) without starting a process.
- **Resume / fork / new** — runs `claude --resume <id>`, `--fork-session`, or `--session-id <uuid>` in a real ConPTY. Sessions keep running in the background while you switch tabs; tabs show *working* (pulsing) and *done while you were away* (blue) states.
- **WSL sessions too** — every running WSL distro's `~/.claude` is indexed by a small Python agent that runs *inside* Linux (reading over `\\wsl.localhost` is ~9 MB/s, far too slow for large histories); results are cached incrementally in `%LOCALAPPDATA%\agent-deck\wsl-index.json`. WSL sessions resume with the distro's own `claude`, and their shells are real Linux shells (`wsl.exe -d <distro> --cd <path>`). Stopped distros show a *Start* button instead of being booted silently.
- **Delete sessions** — right-click → *Delete session…* (or the Delete button in the preview). Windows sessions go to the Recycle Bin; WSL sessions are deleted permanently. Running sessions can't be deleted.
- **Detects sessions open elsewhere** (from `~/.claude/sessions`) and warns before double-resuming; *Close there, resume here* ends the other process (only when its live record and start time match) and resumes it in Deck.
- **Shells per session** — any number of PowerShell tabs in the session folder (`Ctrl+\``). Background shells the agent starts (`run_in_background`) appear as read-only tabs with live output when you open them.
- **Subagents** — running subagents show live in a panel opened from the status bar, each streaming its own transcript; their tabs close when they finish.
- **Explorer + viewer** — virtualized tree with live file watching (an inotify watcher inside WSL for Linux folders); markdown preview (GFM, sanitized), syntax-highlighted code with edit & save, images, PDF, audio/video. Files auto-reload when an agent edits them; saving detects changes made on disk meanwhile and asks before overwriting, keeps UTF-16 files in their encoding, and opens undecodable files read-only. "Mention" inserts `@path`.
- **What changed** — files Claude edited in this session (with diffs against its own backups) plus uncommitted git changes.
- **Agent config** (`Ctrl+Shift+J`) — everything the session's agent loads for the open folder. Claude: memory (CLAUDE.md files and auto memory), MCP servers, skills, agents, slash commands, hooks, permission rules, plugins and settings files. Codex: AGENTS.md, config.toml MCP servers, skills, prompts, command rules, plugins and config files. Any listed item can be removed (files go to the Recycle Bin, permanently in WSL). Click an MCP server to start it and try its tools; Postgres servers also get a table browser and SQL editor using the server's own credentials (secrets never reach the UI).
- **Search inside conversations** (`Ctrl+Shift+F`) — full-text search across every transcript, Windows and WSL.
- **Attention** — notification, sound, taskbar badge and an optional spoken announcement when an agent finishes (and none of its subagents are still running) or needs approval while you're elsewhere, plus optional phone pings through ntfy.sh (anyone who knows the topic can read them, so Deck generates a random one). `Ctrl+Shift+A` or the status bar jumps to the waiting session. Deckie, the status bar pet, naps, works, waves and celebrates along with your sessions.
- **Notes** (`Ctrl+Alt+N`) — autosaving notes, stored as Markdown files in the app data folder.
- **Hide mode** (`Ctrl+Shift+H`) — a low-key look for screen sharing: One Dark theme, the window title and icon switch to Warp's (read from a local Warp install, if any), the search bar, title bar buttons, agent shells, subagents and pet are hidden, and sound, voice and desktop notifications are muted; phone pings still arrive.
- **Pin / rename / archive** sessions, 15 themes, clickable file paths in terminal output (resolved against the agent's recent working folders, with `:line`), drag files from the explorer into a terminal to mention them.
- **Command palette** (`Ctrl+Shift+P`), **quick open** (`Ctrl+P`) and a shortcut sheet (`Ctrl+/`).
- Tabs survive app restarts (reopen as previews) and UI reloads (terminals reattach with replayed output). Closing a tab or quitting asks first when something is running or a file has unsaved edits.
- **Safe by default** — local files reach the page only through Deck's own `deckfile:` scheme, which refuses network (UNC) paths and credential folders; "Open with default app" never launches programs or scripts; MCP secrets are masked in every view; the SQL editor and MCP tools ask before statements that change data.

## Shortcuts

| Action | Keys |
|---|---|
| Command palette | `Ctrl+Shift+P` |
| Go to file | `Ctrl+P` |
| New session in current folder | `Ctrl+Shift+N` |
| Toggle / new shell | ``Ctrl+` `` / ``Ctrl+Shift+` `` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Search sessions | `Ctrl+Shift+S` |
| Session panel: Files / Changes / Agent | `Ctrl+Shift+E` / `G` / `J` |
| Toggle sessions list / session panel | `Ctrl+Shift+B` / `Ctrl+Alt+B` |
| Search conversations | `Ctrl+Shift+F` |
| Reopen closed tab / jump to waiting session | `Ctrl+Shift+T` / `Ctrl+Shift+A` |
| Jump to tab | `Ctrl+1…9` |
| Find in terminal | `Ctrl+F` |
| All shortcuts | `Ctrl+/` |
| Settings | `Ctrl+,` |
| Notes | `Ctrl+Alt+N` |
| Hide mode | `Ctrl+Shift+H` |
| Close file | `Ctrl+Shift+W` |
| Terminal font size | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Newline in Claude prompt | `Shift+Enter` |
| Copy / paste in terminal | `Ctrl+C` with selection / `Ctrl+V`, right-click |

## Develop

Requires Node 22.12+, Rust (stable, MSVC) and the VS C++ build tools. WSL support needs `python3` inside each distro.

```powershell
npm install
npm run app:dev      # dev app with hot reload (separate identifier, so it runs beside an installed copy)
npm run app:build    # release exe + NSIS installer in src-tauri/target/release/bundle/nsis
npm run check       # typecheck + vitest
cd src-tauri; cargo test --lib
```

## Layout

```
src-tauri/src/
  commands.rs   every Tauri command (thin wrappers; blocking work off the main thread)
  sessions.rs   session index (incremental JSONL parsing, rayon), transcripts, search, rename, delete
  changes.rs    "what changed" from session file-history backups
  git.rs        hardened git status / HEAD reads
  codex.rs      Codex rollout sessions
  tasks.rs      agent background shells and subagents
  agent_config/ what each agent loads: Claude and Codex readers, removal, MCP server resolution, secret masking
  mcp.rs        MCP client (stdio + streamable HTTP), one pooled client per server
  pg.rs         Postgres browser for database MCP servers (tokio-postgres, cancel, WSL relay)
  file_protocol.rs  deckfile: scheme for images and media, guarded before any file access
  pool.rs       keyed get-or-create pool used by MCP and Postgres
  process.rs    Windows Job Objects so helper processes die with their children
  wsl.rs        WSL bridge; wsl_agent.py runs inside the distro
  pty.rs        ConPTY terminals: reader + coalescing sender threads, replay buffer, env scrubbing
  fsx.rs        directory listing, file read/write with conflict detection, open/reveal, gitignore-aware file list
  watcher.rs    debounced file watchers (folders + ~/.claude)
  notes.rs      notes page storage
  phone.rs      ntfy.sh phone pings
  hide_mode.rs  hide mode window title and icon
  util.rs       shared helpers, sensitive-path and network-path guards
src/
  lib/terminal/registry.ts   xterm instances live outside React (never lost on tab switch)
  actions/                   user-level operations (sessions, workspaces, files, notes, hide mode) used by every UI surface
  stores/                    zustand: workspaces (persisted), terminals, sessions, explorer, viewer, ui, settings, agent tasks
  features/                  agent-config, changes, explorer, mcp, notes, palette, settings, shortcuts, sidebar, statusbar, terminal, titlebar, viewer, welcome, workspace
```
