import { create } from "zustand";

import type { AgentTask, SessionTasks, Subagent } from "@/types";

interface AgentTasksState {
  bySession: Record<string, AgentTask[]>;
  agentsBySession: Record<string, Subagent[]>;
  selected: Record<string, string | null>;
  dismissed: Record<string, string[]>;
  setTasks: (sessionId: string, tasks: SessionTasks) => void;
  select: (workspaceId: string, taskId: string | null) => void;
  dismiss: (sessionId: string, taskId: string) => void;
}

export const useAgentTasksStore = create<AgentTasksState>((set, get) => ({
  bySession: {},
  agentsBySession: {},
  selected: {},
  dismissed: {},
  setTasks: (sessionId, { shells, agents }) => {
    const same = <T>(current: T | undefined, next: T) =>
      current !== undefined && JSON.stringify(current) === JSON.stringify(next);
    const state = get();
    const sameShells = same(state.bySession[sessionId], shells);
    const sameAgents = same(state.agentsBySession[sessionId], agents);
    if (sameShells && sameAgents) return;
    set((s) => ({
      bySession: sameShells ? s.bySession : { ...s.bySession, [sessionId]: shells },
      agentsBySession: sameAgents
        ? s.agentsBySession
        : { ...s.agentsBySession, [sessionId]: agents },
    }));
  },
  select: (workspaceId, taskId) =>
    set((s) => ({ selected: { ...s.selected, [workspaceId]: taskId } })),
  dismiss: (sessionId, taskId) =>
    set((s) => ({
      dismissed: { ...s.dismissed, [sessionId]: [...(s.dismissed[sessionId] ?? []), taskId] },
    })),
}));
