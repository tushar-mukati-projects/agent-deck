import { create } from "zustand";

import { sameJson } from "@/lib/utils";
import type { AgentTask, SessionTasks, Subagent } from "@/types";

interface AgentTasksState {
  bySession: Record<string, AgentTask[]>;
  agentsBySession: Record<string, Subagent[]>;
  selected: Record<string, string | null>;
  setTasks: (sessionId: string, tasks: SessionTasks) => void;
  select: (workspaceId: string, taskId: string | null) => void;
}

export const useAgentTasksStore = create<AgentTasksState>((set, get) => ({
  bySession: {},
  agentsBySession: {},
  selected: {},
  setTasks: (sessionId, { shells, agents }) => {
    const state = get();
    const sameShells = sameJson(state.bySession[sessionId], shells);
    const sameAgents = sameJson(state.agentsBySession[sessionId], agents);
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
}));
