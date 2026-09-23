import type { LiveSession, SessionInfo, TerminalState } from "@/types";

export const externalLive = (live: LiveSession[], terminals: Record<string, TerminalState>) => {
  const ownPids = new Set(
    Object.values(terminals)
      .map((t) => t.pid)
      .filter((pid): pid is number => pid !== null),
  );
  return live.filter((entry) => !ownPids.has(entry.pid));
};

export const mergeSessions = (windows: SessionInfo[], wsl: SessionInfo[]) => {
  const wslIds = new Set(wsl.map((s) => s.id));
  const sessions = [...wsl, ...windows.filter((s) => !wslIds.has(s.id))].sort(
    (a, b) => b.modifiedMs - a.modifiedMs,
  );
  return { sessions, byId: Object.fromEntries(sessions.map((s) => [s.id, s])) };
};

export const sessionsSignature = (sessions: SessionInfo[]) =>
  sessions.map((s) => `${s.id}:${s.modifiedMs}:${s.title}`).join("|");

export const liveSignature = (live: LiveSession[]) =>
  live.map((l) => `${l.sessionId}:${l.pid}:${l.status}`).join("|");
