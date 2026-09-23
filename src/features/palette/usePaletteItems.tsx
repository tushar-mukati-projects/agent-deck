import { useEffect, useMemo, useState } from "react";
import {
  AppWindow,
  Bell,
  BrainCircuit,
  Copy,
  FolderOpen,
  FolderPlus,
  GitCompare,
  GitFork,
  Keyboard,
  MessageSquareText,
  MessagesSquare,
  Palette,
  PanelLeft,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  SquareTerminal,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import {
  openSessionByClick,
  resumeWorkspace,
  startSessionInPickedFolder,
} from "@/actions/sessions";
import { closeIdleWorkspaces, closeOtherWorkspaces, closeWorkspace } from "@/actions/workspaces";
import { runShortcut } from "@/hooks/useGlobalShortcuts";
import { FileIcon } from "@/lib/file-icons";
import { fuzzyPathScore, fuzzyScore } from "@/lib/fuzzy";
import { shortcutLabel, type ShortcutAction } from "@/lib/shortcuts";
import { api } from "@/lib/tauri/commands";
import { copyText, revealInExplorer } from "@/lib/tauri/system";
import { THEMES } from "@/lib/themes";
import { basename, joinPath, shortenHome, timeAgo } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { PaletteMode } from "@/stores/ui-store";
import { useActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { SearchHit, Workspace } from "@/types";

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
const CHAT_SEARCH_DELAY_MS = 250;
const fileCache = new Map<string, { at: number; files: string[] }>();

const useFileList = (root: string | null, enabled: boolean) => {
  const [files, setFiles] = useState<string[] | null>(null);
  useEffect(() => {
    if (!root || !enabled) return;
    const cached = fileCache.get(root);
    if (cached) setFiles(cached.files);
    if (cached && Date.now() - cached.at < FILE_CACHE_MS) return;
    let cancelled = false;
    api
      .listFiles(root)
      .then((list) => {
        fileCache.set(root, { at: Date.now(), files: list });
        if (!cancelled) setFiles(list);
      })
      .catch(() => !cancelled && setFiles([]));
    return () => {
      cancelled = true;
    };
  }, [root, enabled]);
  return files;
};

const useChatSearch = (query: string, enabled: boolean) => {
  const includeWsl = useSettingsStore((s) => s.includeWsl);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (!enabled || query.length < 2) {
      setHits(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api
        .searchSessions(query, includeWsl)
        .then((result) => !cancelled && setHits(result))
        .catch(() => !cancelled && setHits([]))
        .finally(() => !cancelled && setSearching(false));
    }, CHAT_SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, enabled, includeWsl]);
  return { hits, searching };
};

interface CommandDef {
  id: string;
  title: string;
  icon: React.ReactNode;
  shortcut?: ShortcutAction;
  run: () => void;
}

const shortcut = (action: ShortcutAction, title: string, icon: React.ReactNode): CommandDef => ({
  id: action,
  title,
  icon,
  shortcut: action,
  run: () => runShortcut(action),
});

const buildCommands = (workspace: Workspace | null): CommandDef[] => {
  const store = useWorkspaceStore.getState();
  const settings = useSettingsStore.getState();
  const commands: CommandDef[] = [
    workspace
      ? {
          id: "new-here",
          title: `New session in ${basename(workspace.cwd)}`,
          icon: <Sparkles />,
          shortcut: "newSession",
          run: () => store.newSession(workspace.cwd),
        }
      : shortcut("newSession", "New session in folder…", <Sparkles />),
    {
      id: "new-folder",
      title: "New session in another folder…",
      icon: <FolderPlus />,
      run: () => void startSessionInPickedFolder(workspace?.cwd),
    },
    shortcut("searchChats", "Search inside conversations", <MessageSquareText />),
    shortcut("reopenTab", "Reopen closed tab", <RotateCcw />),
    shortcut("nextAttention", "Jump to session waiting for you", <Bell />),
    shortcut("showSessions", "Show sessions", <MessagesSquare />),
    shortcut("showExplorer", "Show explorer", <FolderOpen />),
    shortcut("showChanges", "Show what changed", <GitCompare />),
    shortcut("showClaude", "Show Claude memory, MCP servers, skills and agents", <BrainCircuit />),
    shortcut("toggleSidebar", "Toggle sidebar", <PanelLeft />),
    {
      id: "refresh",
      title: "Refresh session list",
      icon: <RefreshCw />,
      run: () => void useSessionsStore.getState().refresh(),
    },
    {
      id: "close-idle",
      title: "Close tabs with nothing running",
      icon: <X />,
      run: () => void closeIdleWorkspaces(),
    },
    shortcut("fontBigger", "Terminal: bigger font", <ZoomIn />),
    shortcut("fontSmaller", "Terminal: smaller font", <ZoomOut />),
    shortcut("shortcuts", "Keyboard shortcuts", <Keyboard />),
    shortcut("settings", "Settings", <Settings />),
    ...THEMES.map((theme) => ({
      id: `theme-${theme.id}`,
      title: `Theme: ${theme.name}`,
      icon: <Palette />,
      run: () => settings.set({ themeId: theme.id }),
    })),
  ];
  if (!workspace) return commands;
  return [
    ...(workspace.mode === "preview"
      ? [
          {
            id: "resume",
            title: "Resume this session",
            icon: <Play />,
            run: () => void resumeWorkspace(workspace.id),
          },
        ]
      : []),
    {
      id: "fork",
      title: "Fork this session",
      icon: <GitFork />,
      run: () => void resumeWorkspace(workspace.id, { fork: true }),
    },
    shortcut("newShell", "New shell", <SquareTerminal />),
    shortcut("toggleShell", "Toggle shell panel", <SquareTerminal />),
    {
      id: "reveal",
      title: "Reveal folder in File Explorer",
      icon: <FolderOpen />,
      run: () => void revealInExplorer(workspace.cwd),
    },
    {
      id: "copy-id",
      title: "Copy session ID",
      icon: <Copy />,
      run: () => void copyText(workspace.sessionId),
    },
    {
      id: "copy-resume",
      title: "Copy resume command",
      icon: <Copy />,
      run: () => void copyText(`claude --resume ${workspace.sessionId}`),
    },
    {
      id: "close",
      title: "Close this tab",
      icon: <X />,
      run: () => void closeWorkspace(workspace.id),
    },
    {
      id: "close-others",
      title: "Close other tabs",
      icon: <X />,
      run: () => void closeOtherWorkspaces(workspace.id),
    },
    ...commands,
  ];
};

const sortTop = (list: PaletteItem[], limit = MAX_PER_GROUP) =>
  list.sort((a, b) => b.score - a.score).slice(0, limit);

export const usePaletteItems = (mode: PaletteMode, rawQuery: string) => {
  const sessions = useSessionsStore((s) => s.sessions);
  const byId = useSessionsStore((s) => s.byId);
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspace = useActiveWorkspace();
  const commandMode = mode === "commands" || rawQuery.startsWith(">");
  const query = rawQuery.replace(/^>/, "").trim().toLowerCase();
  const files = useFileList(
    workspace?.cwd ?? null,
    mode === "files" || (mode === "all" && query.length > 0),
  );
  const chats = useChatSearch(query, mode === "chats");

  const workspaceId = workspace?.id;
  const workspaceMode = workspace?.mode;
  const commands = useMemo(() => buildCommands(workspace), [workspaceId, workspaceMode]);

  const items = useMemo(() => {
    const commandItems = (): PaletteItem[] =>
      commands.flatMap((c) => {
        const score = fuzzyScore(query, c.title);
        return score === null
          ? []
          : [
              {
                id: `cmd:${c.id}`,
                group: "Actions",
                title: c.title,
                icon: c.icon,
                hint: c.shortcut && shortcutLabel(c.shortcut),
                score,
                run: c.run,
              },
            ];
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
          run: () =>
            useWorkspaceStore.getState().openFile(workspace.id, joinPath(workspace.cwd, rel)),
        });
        if (!query && scored.length >= 60) break;
      }
      return scored;
    };

    const chatItems = (): PaletteItem[] =>
      (chats.hits ?? []).flatMap((hit, index) => {
        const session = byId[hit.sessionId];
        if (!session) return [];
        return [
          {
            id: `chat:${hit.sessionId}:${index}`,
            group: session.title ?? "Untitled session",
            title: hit.snippet,
            subtitle: `${hit.role === "user" ? "You" : "Claude"} · ${basename(session.cwd)} · ${timeAgo(session.modifiedMs)}`,
            icon: <MessageSquareText />,
            score: -index,
            run: () => openSessionByClick(session),
          },
        ];
      });

    if (commandMode) return sortTop(commandItems(), 100);
    if (mode === "files") return sortTop(fileItems(), 80);
    if (mode === "chats") return chatItems();

    const tabItems = workspaces.flatMap((w) => {
      const score = fuzzyScore(query, `${w.title} ${w.cwd}`);
      return score === null
        ? []
        : [
            {
              id: `tab:${w.id}`,
              group: "Open tabs",
              title: w.title,
              subtitle: shortenHome(w.cwd, home),
              icon: <AppWindow />,
              score,
              run: () => useWorkspaceStore.getState().activate(w.id),
            },
          ];
    });

    const openSessionIds = new Set(workspaces.map((w) => w.sessionId));
    const sessionItems = sessions.flatMap((s) => {
      if (openSessionIds.has(s.id)) return [];
      const score = fuzzyScore(
        query,
        `${s.title ?? ""} ${basename(s.cwd)} ${s.gitBranch ?? ""} ${s.lastPrompt ?? ""}`,
      );
      return score === null
        ? []
        : [
            {
              id: `session:${s.id}`,
              group: "Sessions",
              title: s.title ?? "Untitled session",
              subtitle: `${shortenHome(s.cwd, home)} · ${timeAgo(s.modifiedMs)}`,
              icon: <MessagesSquare />,
              score: score + s.modifiedMs / 1e13,
              run: () => openSessionByClick(s),
            },
          ];
    });

    return [
      ...sortTop(tabItems, 8),
      ...sortTop(sessionItems, query ? 30 : 12),
      ...(query ? sortTop(fileItems(), 15) : []),
      ...sortTop(commandItems(), query ? 8 : 6),
    ];
  }, [
    commandMode,
    mode,
    query,
    commands,
    workspace,
    files,
    workspaces,
    sessions,
    byId,
    home,
    chats.hits,
  ]);

  const loading = (mode === "files" && !files) || (mode === "chats" && chats.searching);
  const emptyHint =
    mode === "files" && !workspace
      ? "Open a session to search its files."
      : mode === "chats"
        ? query.length < 2
          ? "Type at least 2 characters to search every conversation."
          : chats.searching
            ? "Searching conversations…"
            : "No conversation mentions that."
        : "Nothing matches.";

  return { items, loading, emptyHint };
};
