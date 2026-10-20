import { useDeferredValue, useMemo } from "react";
import { AppWindow, MessageSquareText, MessagesSquare } from "lucide-react";

import { openSessionByClick } from "@/actions/sessions";
import { openTypedPath } from "@/actions/files";
import { buildCommands } from "@/features/palette/commands";
import { useChatSearch } from "@/features/palette/useChatSearch";
import { useFileMatches } from "@/features/palette/useFileMatches";
import { FileIcon } from "@/lib/file-icons";
import { fuzzyScore } from "@/lib/fuzzy";
import { emptyHint, sortTop } from "@/lib/palette";
import { sessionTitle } from "@/lib/sessions";
import { shortcutLabel } from "@/lib/shortcuts";
import { parseTypedPath } from "@/lib/typed-path";
import { basename, groupBy, joinPath, shortenHome, timeAgo } from "@/lib/utils";
import { agentName } from "@/stores/agents";
import { useSessionsStore } from "@/stores/sessions-store";
import type { PaletteMode } from "@/stores/ui-store";
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
  const files = useFileMatches(
    workspace?.cwd ?? null,
    wantFiles,
    query,
    mode === "files" ? FILES_MODE_LIMIT : MIXED_FILE_LIMIT,
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

    const fileItems = (): PaletteItem[] => {
      if (!workspace) return [];
      return files.matches.map(({ rel, score }) => ({
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
    files.matches,
    workspaces,
    sessions,
    byId,
    home,
    chats.hits,
  ]);

  const loading =
    (mode === "files" && !files.listed && !files.error) || (mode === "chats" && chats.searching);
  const hint = emptyHint({
    mode,
    hasWorkspace: !!workspace,
    query,
    searchingChats: chats.searching,
    chatError: chats.error,
    filesError: wantFiles ? files.error : null,
  });

  return { items, loading, emptyHint: hint };
};
