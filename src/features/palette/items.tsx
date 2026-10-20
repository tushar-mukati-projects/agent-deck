import { AppWindow, MessageSquareText, MessagesSquare } from "lucide-react";

import { openSessionByClick } from "@/actions/sessions";
import { openTypedPath } from "@/actions/files";
import { FileIcon } from "@/lib/file-icons";
import { fuzzyScore } from "@/lib/fuzzy";
import { sortTop, type ScoredFile } from "@/lib/palette";
import { sessionTitle } from "@/lib/sessions";
import { shortcutLabel } from "@/lib/shortcuts";
import { basename, groupBy, joinPath, shortenHome, timeAgo } from "@/lib/utils";
import { agentName } from "@/stores/agents";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { CommandDef } from "@/features/palette/commands";
import type { SearchHit, SessionInfo, Workspace } from "@/types";

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
const SESSION_MATCH_LIMIT = 30;
const RECENT_SESSION_LIMIT = 12;
const RECENCY_MS_PER_POINT = 1e13;

export const commandItems = (commands: CommandDef[], query: string): PaletteItem[] =>
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

export const fileItems = (workspace: Workspace | null, matches: ScoredFile[]): PaletteItem[] => {
  if (!workspace) return [];
  return matches.map(({ rel, isDir, score }) => {
    const path = joinPath(workspace.cwd, rel);
    return {
      id: `${isDir ? "folder" : "file"}:${rel}`,
      group: "Files and folders",
      title: basename(rel),
      subtitle: rel,
      icon: <FileIcon path={rel} isDir={isDir} />,
      score,
      run: isDir
        ? () => void openTypedPath(workspace, path)
        : () => useWorkspaceStore.getState().openFile(workspace.id, path),
    };
  });
};

export const chatItems = (hits: SearchHit[], byId: Record<string, SessionInfo>): PaletteItem[] =>
  [...groupBy(hits, (hit) => hit.sessionId).values()]
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

export const pathItems = (workspace: Workspace, typedPath: string): PaletteItem[] => [
  {
    id: `path:${typedPath}`,
    group: "Go to path",
    title: basename(typedPath) || typedPath,
    subtitle: typedPath,
    icon: <FileIcon path={typedPath} />,
    score: Number.MAX_SAFE_INTEGER,
    run: () => void openTypedPath(workspace, typedPath),
  },
];

export const tabItems = (workspaces: Workspace[], query: string, home: string): PaletteItem[] =>
  workspaces.flatMap((w) => {
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

export const sessionItems = (
  sessions: SessionInfo[],
  workspaces: Workspace[],
  query: string,
  home: string,
): PaletteItem[] => {
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
  return sortTop(scoredSessions, query ? SESSION_MATCH_LIMIT : RECENT_SESSION_LIMIT).map(
    ({ session: s, score }) => ({
      id: `session:${s.id}`,
      group: "Sessions",
      title: sessionTitle(s),
      subtitle: `${shortenHome(s.cwd, home)} · ${timeAgo(s.modifiedMs)}`,
      icon: <MessagesSquare />,
      score,
      run: () => openSessionByClick(s),
    }),
  );
};
