import { basename, dirname, isWithin, normalizePath, samePath } from "@/lib/utils";
import type { DotTone } from "@/components/ui/feedback";
import type { AgentId, SessionInfo } from "@/types";

const TONE_PRIORITY: DotTone[] = ["attention", "busy", "running", "external"];

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

const searchTexts = new WeakMap<SessionInfo, string>();

const searchText = (session: SessionInfo) => {
  let text = searchTexts.get(session);
  if (text === undefined) {
    text = [
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
    searchTexts.set(session, text);
  }
  return text;
};

const searchTerms = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean);

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

const countBy = (values: string[]) => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
};

export const folderHints = (groups: SessionGroup[]) => {
  const names = countBy(groups.map(({ cwd }) => basename(cwd).toLowerCase()));
  const shared = groups.filter(({ cwd }) => (names.get(basename(cwd).toLowerCase()) ?? 0) > 1);
  const parents = countBy(shared.map(({ cwd }) => basename(dirname(cwd)).toLowerCase()));
  return new Map(
    shared.map(({ cwd }) => {
      const parent = basename(dirname(cwd));
      return [cwd, (parents.get(parent.toLowerCase()) ?? 0) > 1 ? dirname(cwd) : parent];
    }),
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

export const groupTone = (sessions: SessionInfo[], tones: Map<string, DotTone>) => {
  const present = new Set(sessions.map((s) => tones.get(s.id)));
  return TONE_PRIORITY.find((tone) => present.has(tone)) ?? null;
};

export const emptyMessage = (query: string, folderFilter: string | null) => {
  if (query)
    return {
      title: "No matching sessions",
      description: folderFilter
        ? "Try a different search, or clear the folder filter."
        : "Try a different search.",
    };
  if (folderFilter)
    return {
      title: "No sessions in this folder yet",
      description: `Start a session in ${basename(folderFilter)} and it will show up here.`,
    };
  return {
    title: "No sessions yet",
    description: "Start a session with any agent and it will show up here.",
  };
};
