# Agent Deck

A Windows app for your Claude Code and Codex sessions. It lists every session from every folder, lets you read one before you resume it, and runs several side by side, each with its own shells, file explorer and diff view.

![Agent Deck demo](assets/demo.gif)

## Install

1. Download `agent-deck-0.1.0-x64-setup.exe` from [Releases](https://github.com/SDE-Tushar-Funity/agent-deck/releases).
2. Run it. It installs for your user only, no admin needed.

You need Windows 10 or 11 (x64) and Claude Code or Codex on your PATH. WSL sessions also need `python3` inside the distro.

Used Claude Deck before? The first launch copies its notes, tabs and settings over.

## Use

- **Left:** all your sessions, grouped by folder, from Windows and every running WSL distro. Click one to read it.
- **Middle:** press Enter or Resume to continue the session in a real terminal, or Fork to branch it. Several sessions run at once, one per tab, and keep running when you switch tabs.
- **Bottom:** shells for the session's folder (``Ctrl+` ``), plus the agent's own background shells and subagents while they run.
- **Right:** Files, Changes and the agent's config for the active session.

## Features

- Claude Code, Codex and any other CLI agent you add in Settings.
- Preview a conversation without starting a process; search inside every conversation.
- File explorer with live updates, a code viewer and editor, Markdown, images, PDF, audio and video.
- Changes: files the agent edited in this session, plus uncommitted git changes, as diffs.
- Agent config: memory files, MCP servers (with a tool runner and a Postgres browser), skills, agents, commands, hooks, permissions and plugins, with removal.
- Alerts when an agent finishes or needs approval: sound, notification, taskbar badge, spoken announcement and optional phone pings through ntfy.sh.
- Command palette, quick open, notes, 15 themes, and a hide mode for screen sharing.

## Shortcuts

| Action | Keys |
|---|---|
| Command palette | `Ctrl+Shift+P` |
| Go to file | `Ctrl+P` |
| Search inside conversations | `Ctrl+Shift+F` |
| New session in this folder | `Ctrl+Shift+N` |
| Next / previous tab | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Jump to tab | `Ctrl+1…9` |
| Reopen closed tab | `Ctrl+Shift+T` |
| Jump to the session waiting for you | `Ctrl+Shift+A` |
| Files / Changes / Agent config | `Ctrl+Shift+E` / `G` / `J` |
| Sessions list / session panel | `Ctrl+Shift+B` / `Ctrl+Alt+B` |
| Toggle shell panel / new shell | ``Ctrl+` `` / ``Ctrl+Shift+` `` |
| Find in terminal | `Ctrl+F` |
| Terminal font size | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Settings | `Ctrl+,` |
| Notes | `Ctrl+Alt+N` |
| Hide mode | `Ctrl+Shift+H` |
| All shortcuts | `Ctrl+/` |

## Config

- **Settings** (`Ctrl+,`): theme, default agent, extra agent CLIs, WSL sessions, what a session click does, terminal font, and alerts.
- **Environment:** `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are respected, the same way the CLIs use them.
- **Data:** settings and tabs live in the app's WebView storage under `%LOCALAPPDATA%\dev.tushar.agentdeck`, notes in `%APPDATA%\dev.tushar.agentdeck\notes`, and the WSL session index in `%LOCALAPPDATA%\agent-deck`.

## Build

Needs Node 22.12+, Rust (stable, MSVC) and the Visual Studio C++ build tools.

```powershell
npm install
npm run app:dev      # dev app with hot reload, runs beside an installed copy
npm run check        # typecheck and tests
npm run app:build    # installer in src-tauri\target\release\bundle\nsis
```
