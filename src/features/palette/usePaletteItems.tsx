import { useEffect, useMemo, useState } from "react";
import {
  AppWindow,
  Copy,
  FolderOpen,
  FolderPlus,
  GitFork,
  MessagesSquare,
  Palette,
  PanelLeft,
  Play,
  RefreshCw,
  Settings,
  SquareTerminal,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { startSessionInPickedFolder } from "@/features/titlebar/NewSessionMenu";
import { closeWorkspaceWithConfirm } from "@/hooks/useCloseWorkspace";
import { resumeWorkspace } from "@/hooks/useResumeSession";
import { FileIcon } from "@/lib/file-icons";
import { fuzzyPathScore, fuzzyScore } from "@/lib/fuzzy";
import { shortcutLabel, type ShortcutAction } from "@/lib/shortcuts";
import { api } from "@/lib/tauri/commands";
import { THEMES } from "@/lib/themes";
import { copyText, revealInExplorer } from "@/lib/tauri/system";
import { basename, joinPath, shortenHome, timeAgo } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { PaletteMode } from "@/stores/ui-store";
import { useUiStore } from "@/stores/ui-store";
import { useActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";

export interface PaletteItem {
  id: string;
  group: string;
  title: string;
  subtitle?: string;
  hint?: string;
  icon: React.ReactNode;
  score: number;
  run: () => void;
}

const MAX_PER_GROUP = 40;
const FILE_CACHE_MS = 20_000;
const fileCache = new Map<string, { at: number; files: string[] }>();

const useFileList = (root: string | null, enabled: boolean) => {
  const [files, setFiles] = useState<string[] | null>(null);
  useEffect(() => {
    if (!root || !enabled) return;
    const cached = fileCache.get(root);
    if (cached) setFiles(cached.files);
    if (cached && Date.now() - cached.at < FILE_CACHE_MS) return;
    let cancelled = false;
    void api.listFiles(root).then((list) => {
      fileCache.set(root, { at: Date.now(), files: list });
      if (!cancelled) setFiles(list);
    });
    return () => {
      cancelled = true;
    };
  }, [root, enabled]);
  return files;
};

interface CommandDef {
  id: string;
  title: string;
  icon: React.ReactNode;
  shortcut?: ShortcutAction;
  when?: boolean;
  run: () => void;
}

const useCommands = (): CommandDef[] => {
  const workspace = useActiveWorkspace();
  const store = useWorkspaceStore.getState();
  const ui = useUiStore.getState();
  const settings = useSettingsStore.getState();
  const all: CommandDef[] = [
    {
      id: "new-here",
      title: workspace ? `New session in ${basename(workspace.cwd)}` : "New session in folder…",
      icon: <Sparkles />,
      shortcut: "newSession",
      run: () => (workspace ? store.newSession(workspace.cwd) : void startSessionInPickedFolder()),
    },
    { id: "new-folder", title: "New session in folder…", icon: <FolderPlus />, when: !!workspace, run: () => void startSessionInPickedFolder(workspace?.cwd) },
    { id: "resume", title: "Resume this session", icon: <Play />, when: workspace?.mode === "preview", run: () => workspace && void resumeWorkspace(workspace.id) },
    { id: "fork", title: "Fork this session", icon: <GitFork />, when: !!workspace, run: () => workspace && store.resume(workspace.id, { fork: true }) },
    { id: "shell", title: "New shell", icon: <SquareTerminal />, shortcut: "newShell", when: !!workspace, run: () => workspace && store.openShell(workspace.id) },
    { id: "toggle-shell", title: "Toggle shell panel", icon: <SquareTerminal />, shortcut: "toggleShell", when: !!workspace, run: () => workspace && store.setShellPanel(workspace.id, !workspace.shellPanelOpen) },
    { id: "sessions", title: "Show sessions", icon: <MessagesSquare />, shortcut: "showSessions", run: () => ui.setSidebarView("sessions") },
    { id: "explorer", title: "Show explorer", icon: <FolderOpen />, shortcut: "showExplorer", run: () => ui.setSidebarView("explorer") },
    { id: "sidebar", title: "Toggle sidebar", icon: <PanelLeft />, shortcut: "toggleSidebar", run: ui.toggleSidebar },
    { id: "reveal", title: "Reveal folder in File Explorer", icon: <FolderOpen />, when: !!workspace, run: () => workspace && void revealInExplorer(workspace.cwd) },
    { id: "copy-id", title: "Copy session ID", icon: <Copy />, when: !!workspace, run: () => workspace && void copyText(workspace.sessionId) },
    { id: "close", title: "Close session tab", icon: <X />, when: !!workspace, run: () => workspace && void closeWorkspaceWithConfirm(workspace.id) },
    { id: "refresh", title: "Refresh session list", icon: <RefreshCw />, run: () => void useSessionsStore.getState().refresh() },
    { id: "font-up", title: "Terminal: bigger font", icon: <ZoomIn />, shortcut: "fontBigger", run: () => settings.set({ fontSize: Math.min(22, settings.fontSize + 1) }) },
    { id: "font-down", title: "Terminal: smaller font", icon: <ZoomOut />, shortcut: "fontSmaller", run: () => settings.set({ fontSize: Math.max(9, settings.fontSize - 1) }) },
    { id: "settings", title: "Settings", icon: <Settings />, shortcut: "settings", run: () => ui.setSettingsOpen(true) },
    ...THEMES.map((theme) => ({
      id: `theme-${theme.id}`,
      title: `Theme: ${theme.name}`,
      icon: <Palette />,
      run: () => settings.set({ themeId: theme.id }),
    })),
  ];
  return all.filter((c) => c.when !== false);
};

export const usePaletteItems = (mode: PaletteMode, rawQuery: string) => {
  const sessions = useSessionsStore((s) => s.sessions);
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspace = useActiveWorkspace();
  const commands = useCommands();
  const commandMode = mode === "commands" || rawQuery.startsWith(">");
  const query = rawQuery.replace(/^>/, "").trim().toLowerCase();
  const files = useFileList(workspace?.cwd ?? null, mode === "files" || (mode === "all" && query.length > 0));

  const items = useMemo(() => {
    const results: PaletteItem[] = [];
    const push = (list: PaletteItem[], limit = MAX_PER_GROUP) =>
      results.push(...list.sort((a, b) => b.score - a.score).slice(0, limit));

    const commandItems = (): PaletteItem[] =>
      commands.flatMap((c) => {
        const score = fuzzyScore(query, c.title);
        return score === null
          ? []
          : [{ id: `cmd:${c.id}`, group: "Actions", title: c.title, icon: c.icon, hint: c.shortcut && shortcutLabel(c.shortcut), score, run: c.run }];
      });

    const fileItems = (): PaletteItem[] => {
      if (!workspace || !files) return [];
      const scored: PaletteItem[] = [];
      for (const rel of files) {
        const score = query ? fuzzyPathScore(query, rel) : 0;
        if (score === null) continue;
        scored.push({
          id: `file:${rel}`,
          group: "Files",
          title: basename(rel),
          subtitle: rel,
          icon: <FileIcon path={rel} />,
          score,
          run: () => useWorkspaceStore.getState().openFile(workspace.id, joinPath(workspace.cwd, rel)),
        });
        if (!query && scored.length >= 60) break;
      }
      return scored;
    };

    if (commandMode) {
      push(commandItems(), 100);
      return results;
    }
    if (mode === "files") {
      push(fileItems(), 80);
      return results;
    }

    const tabItems = workspaces.flatMap((w) => {
      const score = fuzzyScore(query, `${w.title} ${w.cwd}`);
      return score === null
        ? []
        : [{ id: `tab:${w.id}`, group: "Open tabs", title: w.title, subtitle: shortenHome(w.cwd, home), icon: <AppWindow />, score, run: () => useWorkspaceStore.getState().activate(w.id) }];
    });
    push(tabItems, 8);

    const openSessionIds = new Set(workspaces.map((w) => w.sessionId));
    const sessionItems = sessions.flatMap((s) => {
      if (openSessionIds.has(s.id)) return [];
      const score = fuzzyScore(query, `${s.title ?? ""} ${basename(s.cwd)} ${s.gitBranch ?? ""} ${s.lastPrompt ?? ""}`);
      return score === null
        ? []
        : [{
            id: `session:${s.id}`,
            group: "Sessions",
            title: s.title ?? "Untitled session",
            subtitle: `${shortenHome(s.cwd, home)} · ${timeAgo(s.modifiedMs)}`,
            icon: <MessagesSquare />,
            score: score + s.modifiedMs / 1e13,
            run: () => useWorkspaceStore.getState().openSession(s),
          }];
    });
    push(sessionItems, query ? 30 : 12);
    if (query) push(fileItems(), 15);
    push(commandItems(), query ? 8 : 6);
    return results;
  }, [commandMode, mode, query, commands, workspace, files, workspaces, sessions, home]);

  return { items, loadingFiles: mode === "files" && !files };
};
