# Claude Deck

A fast desktop home for every Claude Code session on this machine — browse, preview, resume, fork and run them side by side, each with its own shells and a live file explorer.

Built with **Tauri 2** (Rust backend, system WebView2) + **React 19 / TypeScript / Tailwind v4** + **xterm.js** (WebGL).

## Features

- **All sessions, every folder** — indexes `~/.claude/projects/**/*.jsonl` (incrementally, by byte offset), grouped by real working folder. Filter to one folder (with or without subfolders) or browse to any folder.
- **Preview before resuming** — read a conversation (markdown rendered, tool calls summarized) without starting a process.
- **Resume / fork / new** — runs `claude --resume <id>`, `--fork-session`, or `--session-id <uuid>` in a real ConPTY. Sessions keep running in the background while you switch tabs; tabs show *working* (pulsing) and *done while you were away* (blue) states.
- **WSL sessions too** — every running WSL distro's `~/.claude` is indexed by a small Python agent that runs *inside* Linux (reading over `\\wsl.localhost` is ~9 MB/s, far too slow for large histories); results are cached incrementally in `%LOCALAPPDATA%\claude-deck\wsl-index.json`. WSL sessions resume with the distro's own `claude`, and their shells are real Linux shells (`wsl.exe -d <distro> --cd <path>`). Stopped distros show a *Start* button instead of being booted silently.
- **Delete sessions** — right-click → *Delete session…* (or the Delete button in the preview). Windows sessions go to the Recycle Bin; WSL sessions are deleted permanently. Running sessions can't be deleted.
- **Detects sessions open elsewhere** (from `~/.claude/sessions`) and warns before double-resuming.
- **Shells per session** — any number of PowerShell tabs in the session folder (`Ctrl+\``).
- **Explorer + viewer** — virtualized tree with live file watching; markdown preview (GFM, sanitized), syntax-highlighted code with edit & save, images, PDF, audio/video. Files auto-reload when Claude edits them. "Mention in Claude" inserts `@path`.
- **What changed** — files Claude edited in this session (with diffs against its own backups) plus uncommitted git changes.
- **Project view** (`Ctrl+Shift+J`) — run any `package.json` script in a labelled shell tab, start a session with one of the folder's `.claude/agents`, and browse the folder's media (videos, images, audio, rendered frame folders) in a gallery.
- **Search inside conversations** (`Ctrl+Shift+F`) — full-text search across every transcript, Windows and WSL.
- **Attention** — notification, sound and taskbar badge when Claude finishes while you're elsewhere; `Ctrl+Shift+A` or the status bar jumps to the waiting session.
- **Pin / rename / archive** sessions, 21 themes, clickable file paths in terminal output, drag files from the explorer into a terminal to mention them.
- **Command palette** (`Ctrl+Shift+P`), **quick open** (`Ctrl+P`) and a shortcut sheet (`Ctrl+/`).
- Tabs survive app restarts (reopen as previews) and UI reloads (terminals reattach with replayed output).

## Shortcuts

| Action | Keys |
|---|---|
| Command palette | `Ctrl+Shift+P` |
| Go to file | `Ctrl+P` |
| New session in current folder | `Ctrl+Shift+N` |
| Toggle / new shell | ``Ctrl+` `` / ``Ctrl+Shift+` `` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Sessions / Explorer / Changes / Project | `Ctrl+Shift+S` / `E` / `G` / `J` |
| Toggle sidebar | `Ctrl+Shift+B` |
| Search conversations | `Ctrl+Shift+F` |
| Reopen closed tab / jump to waiting session | `Ctrl+Shift+T` / `Ctrl+Shift+A` |
| Jump to tab | `Ctrl+1…9` |
| Find in terminal | `Ctrl+F` |
| All shortcuts | `Ctrl+/` |
| Close file | `Ctrl+Shift+W` |
| Terminal font size | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Newline in Claude prompt | `Shift+Enter` |
| Copy / paste in terminal | `Ctrl+C` with selection / `Ctrl+V`, right-click |

## Develop

Requires Node 20+, Rust (stable, MSVC) and the VS C++ build tools.

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
  project.rs    package scripts, .claude/agents, media index
  wsl.rs        WSL bridge; wsl_agent.py runs inside the distro
  pty.rs        ConPTY terminals: reader + coalescing sender threads, replay buffer, env scrubbing
  fsx.rs        directory listing, file read/write, gitignore-aware file list
  watcher.rs    debounced file watchers (folders + ~/.claude)
src/
  lib/terminal/registry.ts   xterm instances live outside React (never lost on tab switch)
  actions/                   user-level operations (resume, close, delete, mention, run task) used by every UI surface
  stores/                    zustand: workspaces (persisted), terminals, sessions, explorer, viewer, ui, settings
  features/                  titlebar, sidebar, explorer, viewer, changes, project, media, workspace, palette, settings, statusbar
```
