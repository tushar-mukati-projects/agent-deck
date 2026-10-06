import { useDeferredValue, useEffect, useMemo, useState } from "react";
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
  PanelRight,
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
  startNewSession,
  resumeWorkspace,
  startSessionInPickedFolder,
} from "@/actions/sessions";
import { openTypedPath } from "@/actions/files";
import { closeIdleWorkspaces, closeOtherWorkspaces, closeWorkspace } from "@/actions/workspaces";
import { useAsync } from "@/hooks/useAsync";
import { runShortcut } from "@/hooks/useGlobalShortcuts";
import { FileIcon } from "@/lib/file-icons";
import { fuzzyPathScore, fuzzyScore } from "@/lib/fuzzy";
import { shortcutLabel, type ShortcutAction } from "@/lib/shortcuts";
import { api } from "@/lib/tauri/commands";
import { copyText, revealInExplorer } from "@/lib/tauri/system";
import { resumeCommandLine } from "@/lib/agents/launch";
import { agentName, findAgent, listAgents } from "@/lib/agents/registry";
import { THEMES } from "@/lib/themes";
import { parseTypedPath } from "@/lib/typed-path";
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

const listFiles = async (root: string) => {
  const cached = fileCache.get(root);
  if (cached && Date.now() - cached.at < FILE_CACHE_MS) return cached.files;
  const files = await api.listFiles(root).catch(() => cached?.files ?? []);
  fileCache.set(root, { at: Date.now(), files });
  return files;
};

const useFileList = (root: string | null, enabled: boolean) => {
  const active = enabled ? root : null;
  const { data } = useAsync(active ? () => listFiles(active) : null, [active]);
  return data ?? (active ? (fileCache.get(active)?.files ?? null) : null);
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
  const settings = useSettingsStore.getState();
  const commands: CommandDef[] = [
    ...(workspace
      ? listAgents().map((agent) => ({
          id: `new-here:${agent.id}`,
          title: `New ${agent.name} session in ${basename(workspace.cwd)}`,
          icon: <Sparkles />,
          shortcut: agent.id === settings.defaultAgent ? ("newSession" as const) : undefined,
          run: () => void startNewSession(workspace.cwd, agent.id),
        }))
      : [shortcut("newSession", "New session in folder…", <Sparkles />)]),
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
    shortcut(
      "showAgentConfig",
      "Show the agent's memory, MCP servers and skills",
      <BrainCircuit />,
    ),
    shortcut("toggleSessions", "Toggle sessions list", <PanelLeft />),
    shortcut(
      "toggleContext",
      "Toggle session panel (files, changes, agent config)",
      <PanelRight />,
    ),
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
  const session = useSessionsStore.getState().byId[workspace.sessionId];
  const agent = findAgent(workspace.agent);
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
    ...(session && agent.canFork
      ? [
          {
            id: "fork",
            title: "Fork this session",
            icon: <GitFork />,
            run: () => void resumeWorkspace(workspace.id, { fork: true }),
          },
        ]
      : []),
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
    ...(session && agent.history
      ? [
          {
            id: "copy-resume",
            title: "Copy resume command",
            icon: <Copy />,
            run: () => void copyText(resumeCommandLine(session)),
          },
        ]
      : []),
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

const topFiles = (files: string[], query: string, limit: number) => {
  if (!query) return files.slice(0, limit).map((rel) => ({ rel, score: 0 }));
  const top: { rel: string; score: number }[] = [];
  for (const rel of files) {
    const score = fuzzyPathScore(query, rel);
    if (score === null) continue;
    if (top.length < limit) top.push({ rel, score });
    else if (score > top[top.length - 1].score) top[top.length - 1] = { rel, score };
    else continue;
    top.sort((a, b) => b.score - a.score);
  }
  return top;
};

const groupBySession = (hits: SearchHit[]) => {
  const order = [...new Set(hits.map((hit) => hit.sessionId))];
  return order.flatMap((id) => hits.filter((hit) => hit.sessionId === id));
};

export const usePaletteItems = (mode: PaletteMode, liveQuery: string) => {
  const rawQuery = useDeferredValue(liveQuery);
  const sessions = useSessionsStore((s) => s.sessions);
  const byId = useSessionsStore((s) => s.byId);
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspace = useActiveWorkspace();
  const commandMode = mode === "commands" || (mode === "all" && rawQuery.startsWith(">"));
  const query = (commandMode ? rawQuery.replace(/^>/, "") : rawQuery).trim().toLowerCase();
  const files = useFileList(
    workspace?.cwd ?? null,
    mode === "files" || (mode === "all" && query.length > 0),
  );
  const chats = useChatSearch(query, mode === "chats");

  const commands = useMemo(() => buildCommands(workspace), [workspace]);

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

    const fileItems = (limit: number): PaletteItem[] => {
      if (!workspace || !files) return [];
      return topFiles(files, query, limit).map(({ rel, score }) => ({
        id: `file:${rel}`,
        group: "Files",
        title: basename(rel),
        subtitle: rel,
        icon: <FileIcon path={rel} />,
        score,
        run: () =>
          useWorkspaceStore.getState().openFile(workspace.id, joinPath(workspace.cwd, rel)),
      }));
    };

    const chatItems = (): PaletteItem[] =>
      groupBySession(chats.hits ?? []).flatMap((hit, index) => {
        const session = byId[hit.sessionId];
        if (!session) return [];
        return [
          {
            id: `chat:${hit.sessionId}:${index}`,
            group: session.title ?? "Untitled session",
            title: hit.snippet,
            subtitle: `${hit.role === "user" ? "You" : agentName(session.agent)} · ${basename(session.cwd)} · ${timeAgo(session.modifiedMs)}`,
            icon: <MessageSquareText />,
            score: -index,
            run: () => openSessionByClick(session),
          },
        ];
      });

    const typedPath = workspace ? parseTypedPath(rawQuery, workspace.cwd, home) : null;
    const pathItems: PaletteItem[] =
      typedPath && workspace && !commandMode && mode !== "chats"
        ? [
            {
              id: `path:${typedPath}`,
              group: "Go to path",
              title: basename(typedPath) || typedPath,
              subtitle: typedPath,
              icon: <FileIcon path={typedPath} />,
              score: Number.MAX_SAFE_INTEGER,
              run: () => void openTypedPath(workspace, typedPath),
            },
          ]
        : [];

    if (commandMode) return sortTop(commandItems(), 100);
    if (mode === "files") return [...pathItems, ...fileItems(80)];
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
      ...pathItems,
      ...sortTop(tabItems, 8),
      ...sortTop(sessionItems, query ? 30 : 12),
      ...(query ? fileItems(15) : []),
      ...sortTop(commandItems(), query ? 8 : 6),
    ];
  }, [
    commandMode,
    mode,
    query,
    rawQuery,
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
