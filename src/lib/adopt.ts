import { samePath } from "@/lib/utils";
import type { SessionInfo, Workspace } from "@/types";

const ADOPT_BEFORE_MS = 20_000;
export const ADOPT_AFTER_MS = 10 * 60_000;

const startedMs = (session: SessionInfo) => Date.parse(session.startedAt ?? "");

const fits = (workspace: Workspace, session: SessionInfo, started: number) =>
  workspace.agent === session.agent &&
  samePath(workspace.cwd, session.cwd) &&
  started >= workspace.pendingSince! - ADOPT_BEFORE_MS &&
  started <= workspace.pendingSince! + ADOPT_AFTER_MS;

export const adoptSessions = (workspaces: Workspace[], byId: Record<string, SessionInfo>) => {
  const pending = workspaces.filter((w) => w.pendingSince !== null && !byId[w.sessionId]);
  if (!pending.length) return workspaces;
  const taken = new Set(workspaces.map((w) => w.sessionId));
  const earliest = Math.min(...pending.map((w) => w.pendingSince!)) - ADOPT_BEFORE_MS;
  const candidates = Object.values(byId)
    .filter((s) => !taken.has(s.id) && startedMs(s) >= earliest)
    .sort((a, b) => startedMs(a) - startedMs(b));
  const adopted = new Map<string, SessionInfo>();
  for (const session of candidates) {
    const started = startedMs(session);
    const closest = pending
      .filter((w) => !adopted.has(w.id) && fits(w, session, started))
      .sort((a, b) => Math.abs(started - a.pendingSince!) - Math.abs(started - b.pendingSince!))[0];
    if (closest) adopted.set(closest.id, session);
  }
  if (!adopted.size) return workspaces;
  return workspaces.map((w) => {
    const session = adopted.get(w.id);
    return session
      ? {
          ...w,
          sessionId: session.id,
          filePath: session.filePath,
          title: session.title ?? w.title,
          pendingSince: null,
        }
      : w;
  });
};
