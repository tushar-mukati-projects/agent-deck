import type { LiveSession, SessionInfo } from "@/types";

export const externalLive = (live: LiveSession[], ownPids: (number | null)[]) => {
  const own = new Set(ownPids);
  return live.filter((entry) => !own.has(entry.pid));
};

export const mergeSessions = (windows: SessionInfo[], wsl: SessionInfo[]) => {
  const wslIds = new Set(wsl.map((s) => s.id));
  return [...wsl, ...windows.filter((s) => !wslIds.has(s.id))].sort(
    (a, b) => b.modifiedMs - a.modifiedMs,
  );
};

const sameValue = (a: unknown, b: unknown) =>
  a === b ||
  (Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((item, index) => item === b[index]));

const sameSession = (a: SessionInfo, b: SessionInfo) =>
  (Object.keys(b) as (keyof SessionInfo)[]).every((key) => sameValue(a[key], b[key]));

export const reuseSessions = (previous: SessionInfo[], next: SessionInfo[]) => {
  const byId = new Map(previous.map((s) => [s.id, s]));
  let changed = previous.length !== next.length;
  const sessions = next.map((session, index) => {
    const old = byId.get(session.id);
    const kept = old && sameSession(old, session) ? old : session;
    if (kept !== previous[index]) changed = true;
    return kept;
  });
  return changed ? sessions : previous;
};

export const liveSignature = (live: LiveSession[]) =>
  live.map((l) => `${l.distro}:${l.sessionId}:${l.pid}:${l.status}`).join("|");
