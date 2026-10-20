import { useDeferredValue, useMemo } from "react";

import { buildCommands } from "@/features/palette/commands";
import {
  chatItems,
  commandItems,
  fileItems,
  pathItems,
  sessionItems,
  tabItems,
} from "@/features/palette/items";
import { useChatSearch } from "@/features/palette/useChatSearch";
import { useFileMatches } from "@/features/palette/useFileMatches";
import { emptyHint, sortTop } from "@/lib/palette";
import { parseTypedPath } from "@/lib/typed-path";
import { useSessionsStore } from "@/stores/sessions-store";
import type { PaletteMode } from "@/stores/ui-store";
import { useActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";

const FILES_MODE_LIMIT = 80;
const MIXED_FILE_LIMIT = 15;
const COMMAND_MODE_LIMIT = 100;
const TAB_LIMIT = 8;
const COMMAND_MATCH_LIMIT = 8;
const SUGGESTED_COMMAND_LIMIT = 6;

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
    if (commandMode) return sortTop(commandItems(commands, query), COMMAND_MODE_LIMIT);
    if (mode === "chats") return chatItems(chats.hits ?? [], byId);
    const typedPath = workspace ? parseTypedPath(rawQuery, workspace.cwd, home) : null;
    const paths = typedPath && workspace ? pathItems(workspace, typedPath) : [];
    if (mode === "files") return [...paths, ...fileItems(workspace, files.matches)];
    return [
      ...paths,
      ...sortTop(tabItems(workspaces, query, home), TAB_LIMIT),
      ...sessionItems(sessions, workspaces, query, home),
      ...(query ? fileItems(workspace, files.matches) : []),
      ...sortTop(
        commandItems(commands, query),
        query ? COMMAND_MATCH_LIMIT : SUGGESTED_COMMAND_LIMIT,
      ),
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
