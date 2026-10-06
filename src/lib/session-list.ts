import { basename, dirname, isWithin, normalizePath, samePath } from "@/lib/utils";
import type { AgentId, SessionInfo } from "@/types";

export interface SessionFilter {
  agent: AgentId | "all";
  folder: string | null;
  includeSubfolders: boolean;
  query: string;
  pinnedIds: string[];
  archivedIds: string[];
}

export interface SessionGroup {
  cwd: string;
  sessions: SessionInfo[];
}

const searchText = (session: SessionInfo) =>
  [
    session.title,
    session.firstPrompt,
    session.lastPrompt,
    session.cwd,
    session.gitBranch,
    session.id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

export const searchTerms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

export const agentsIn = (sessions: SessionInfo[]) =>
  [...new Set(sessions.map((s) => s.agent))].sort();

export const effectiveAgent = (filter: AgentId | "all", sessions: SessionInfo[]) =>
  filter !== "all" && agentsIn(sessions).includes(filter) ? filter : "all";

const inFolder = (session: SessionInfo, folder: string, includeSubfolders: boolean) =>
  includeSubfolders ? isWithin(session.cwd, folder) : samePath(session.cwd, folder);

export const groupByFolder = (sessions: SessionInfo[]) => {
  const groups = new Map<string, SessionGroup>();
  for (const session of sessions) {
    const key = normalizePath(session.cwd);
    const group = groups.get(key) ?? { cwd: session.cwd, sessions: [] };
    group.sessions.push(session);
    groups.set(key, group);
  }
  return [...groups.values()];
};

export const folderHints = (groups: SessionGroup[]) => {
  const nameOf = (cwd: string) => basename(cwd).toLowerCase();
  const counts = new Map<string, number>();
  for (const { cwd } of groups) counts.set(nameOf(cwd), (counts.get(nameOf(cwd)) ?? 0) + 1);
  return new Map(
    groups
      .filter(({ cwd }) => (counts.get(nameOf(cwd)) ?? 0) > 1)
      .map(({ cwd }) => [cwd, basename(dirname(cwd))]),
  );
};

export const partitionSessions = (sessions: SessionInfo[], filter: SessionFilter) => {
  const terms = searchTerms(filter.query);
  const agent = effectiveAgent(filter.agent, sessions);
  const matched = sessions.filter(
    (s) =>
      (agent === "all" || s.agent === agent) &&
      (!filter.folder || inFolder(s, filter.folder, filter.includeSubfolders)) &&
      (terms.length === 0 || terms.every((term) => searchText(s).includes(term))),
  );
  const archived = new Set(filter.archivedIds);
  const pinned = new Set(filter.pinnedIds);
  const byId = new Map(matched.map((s) => [s.id, s]));
  return {
    total: matched.length,
    pinned: filter.pinnedIds.flatMap((id) => {
      const session = byId.get(id);
      return session && !archived.has(id) ? [session] : [];
    }),
    archived: matched.filter((s) => archived.has(s.id)),
    rest: matched.filter((s) => !archived.has(s.id) && !pinned.has(s.id)),
  };
};
