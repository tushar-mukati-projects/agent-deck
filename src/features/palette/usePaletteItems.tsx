import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  AppWindow,
  Bell,
  BrainCircuit,
  Copy,
  EyeOff,
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
  PencilLine,
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
import { closeIdleWorkspaces, closeOtherWorkspaces, closeWorkspaces } from "@/actions/workspaces";
import { useAsync } from "@/hooks/useAsync";
import { runShortcut } from "@/hooks/useGlobalShortcuts";
import { subscribeFileChanges, watchedSince } from "@/lib/file-events";
import { FileIcon } from "@/lib/file-icons";
import { fuzzyScore, pathKey } from "@/lib/fuzzy";
import {
  emptyHint,
  MIN_CHAT_QUERY,
  sortTop,
  topFiles,
  type PreparedFile,
} from "@/lib/palette";
import { sessionTitle } from "@/lib/sessions";
import { shortcutLabel, type ShortcutAction } from "@/lib/shortcuts";
import { api } from "@/lib/tauri/commands";
import { copyText, revealInExplorer } from "@/lib/tauri/system";
import { resumeCommandLine } from "@/lib/agents/launch";
import { THEMES } from "@/lib/themes";
import { parseTypedPath } from "@/lib/typed-path";
import {
  basename,
  failedTo,
  groupBy,
  joinPath,
  normalizePath,
  shortenHome,
  timeAgo,
} from "@/lib/utils";
import { agentName, findAgent, listAgents } from "@/stores/agents";
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

const FILE_CACHE_MS = 5 * 60_000;
const UNWATCHED_FILE_CACHE_MS = 20_000;
const CHAT_SEARCH_DELAY_MS = 250;
const CHAT_HIT_LIMIT = 150;
const FILES_MODE_LIMIT = 80;
const MIXED_FILE_LIMIT = 15;
const COMMAND_MODE_LIMIT = 100;
const TAB_LIMIT = 8;
const SESSION_MATCH_LIMIT = 30;
const RECENT_SESSION_LIMIT = 12;
const COMMAND_MATCH_LIMIT = 8;
const SUGGESTED_COMMAND_LIMIT = 6;
const RECENCY_MS_PER_POINT = 1e13;
const fileCache = new Map<string, { at: number; files: string[] }>();
const filesChangedAt = new Map<string, number>();

subscribeFileChanges((change) => filesChangedAt.set(normalizePath(change.root), Date.now()));

const listFiles = async (root: string) => {
  const key = normalizePath(root);
  const cached = fileCache.get(key);
  const since = watchedSince(root);
  const watchedThroughout = since !== null && cached !== undefined && since <= cached.at;
  const maxAge = watchedThroughout ? FILE_CACHE_MS : UNWATCHED_FILE_CACHE_MS;
  if (cached && Date.now() - cached.at < maxAge && cached.at > (filesChangedAt.get(key) ?? 0))
    return cached.files;
  const at = Date.now();
  const files = await api.listFiles(root);
  fileCache.set(key, { at, files });
  return files;
};

const useFileList = (root: string | null, wanted: boolean) => {
  const [wantedRoot, setWantedRoot] = useState<string | null>(null);
  useEffect(() => {
    if (wanted && root) setWantedRoot(root);
  }, [wanted, root]);
  const active = wanted || wantedRoot === root ? root : null;
  const { data, error } = useAsync(active ? () => listFiles(active) : null, [active]);
  return {
    files: data ?? (active ? (fileCache.get(normalizePath(active))?.files ?? null) : null),
    error: error ? failedTo("list this folder's files", error) : null,
  };
};

const useChatSearch = (query: string, enabled: boolean) => {
  const includeWsl = useSettingsStore((s) => s.includeWsl);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    setError(null);
    if (!enabled || query.length < MIN_CHAT_QUERY) {
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
        .catch((reason: unknown) => {
          if (cancelled) return;
          setHits([]);
          setError(failedTo("search conversations", reason));
        })
        .finally(() => !cancelled && setSearching(false));
    }, CHAT_SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, enabled, includeWsl]);
  return { hits, error, searching };
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
    shortcut("notes", "Notes", <PencilLine />),
    shortcut("toggleHideMode", "Toggle hide mode", <EyeOff />),
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
            run: () => void copyText(resumeCommandLine(session, useSettingsStore.getState())),
          },
        ]
      : []),
    {
      id: "close",
      title: "Close this tab",
      icon: <X />,
      run: () => void closeWorkspaces([workspace.id]),
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

interface FileNarrowing {
  files: PreparedFile[];
  query: string;
  matched: PreparedFile[];
}

export const usePaletteItems = (mode: PaletteMode, liveQuery: string) => {
  const rawQuery = useDeferredValue(liveQuery);
  const sessions = useSessionsStore((s) => s.sessions);
  const byId = useSessionsStore((s) => s.byId);
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const workspace = useActiveWorkspace();
  const commandMode = mode === "all" && rawQuery.startsWith(">");
  const query = (commandMode ? rawQuery.replace(/^>/, "") : rawQuery).trim().toLowerCase();
  const wantFiles = mode === "files" || (mode === "all" && !commandMode && query.length > 0);
  const { files, error: filesError } = useFileList(workspace?.cwd ?? null, wantFiles);
  const chats = useChatSearch(query, mode === "chats");

  const commands = useMemo(() => buildCommands(workspace), [workspace]);

  const prepared = useMemo(
    () => files?.map((rel) => ({ rel, key: pathKey(rel) })) ?? null,
    [files],
  );
  const fileLimit = mode === "files" ? FILES_MODE_LIMIT : MIXED_FILE_LIMIT;
  const narrowing = useRef<FileNarrowing | null>(null);
  const fileMatches = useMemo(() => {
    if (!wantFiles || !prepared) return [];
    const last = narrowing.current;
    const pool = last?.files === prepared && query.startsWith(last.query) ? last.matched : prepared;
    const { top, matched } = topFiles(pool, query, fileLimit);
    narrowing.current = { files: prepared, query, matched };
    return top;
  }, [wantFiles, prepared, query, fileLimit]);

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
      if (!workspace) return [];
      return fileMatches.map(({ rel, score }) => ({
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
      [...groupBy(chats.hits ?? [], (hit) => hit.sessionId).values()]
        .flat()
        .slice(0, CHAT_HIT_LIMIT)
        .flatMap((hit, index) => {
          const session = byId[hit.sessionId];
          if (!session) return [];
          return [
            {
              id: `chat:${hit.sessionId}:${index}`,
              group: sessionTitle(session),
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

    if (commandMode) return sortTop(commandItems(), COMMAND_MODE_LIMIT);
    if (mode === "files") return [...pathItems, ...fileItems()];
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
    const scoredSessions = sessions.flatMap((s) => {
      if (openSessionIds.has(s.id)) return [];
      const score = fuzzyScore(
        query,
        `${s.title ?? ""} ${basename(s.cwd)} ${s.gitBranch ?? ""} ${s.lastPrompt ?? ""}`,
      );
      return score === null
        ? []
        : [{ session: s, score: score + s.modifiedMs / RECENCY_MS_PER_POINT }];
    });
    const sessionItems = sortTop(
      scoredSessions,
      query ? SESSION_MATCH_LIMIT : RECENT_SESSION_LIMIT,
    ).map(
      ({ session: s, score }): PaletteItem => ({
        id: `session:${s.id}`,
        group: "Sessions",
        title: sessionTitle(s),
        subtitle: `${shortenHome(s.cwd, home)} · ${timeAgo(s.modifiedMs)}`,
        icon: <MessagesSquare />,
        score,
        run: () => openSessionByClick(s),
      }),
    );

    return [
      ...pathItems,
      ...sortTop(tabItems, TAB_LIMIT),
      ...sessionItems,
      ...(query ? fileItems() : []),
      ...sortTop(commandItems(), query ? COMMAND_MATCH_LIMIT : SUGGESTED_COMMAND_LIMIT),
    ];
  }, [
    commandMode,
    mode,
    query,
    rawQuery,
    commands,
    workspace,
    fileMatches,
    workspaces,
    sessions,
    byId,
    home,
    chats.hits,
  ]);

  const loading =
    (mode === "files" && !files && !filesError) || (mode === "chats" && chats.searching);
  const hint = emptyHint({
    mode,
    hasWorkspace: !!workspace,
    query,
    searchingChats: chats.searching,
    chatError: chats.error,
    filesError: wantFiles ? filesError : null,
  });

  return { items, loading, emptyHint: hint };
};
