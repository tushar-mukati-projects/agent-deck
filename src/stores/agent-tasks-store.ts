import { create } from "zustand";

import type { AgentTask } from "@/types";

interface AgentTasksState {
  bySession: Record<string, AgentTask[]>;
  selected: Record<string, string | null>;
  dismissed: Record<string, string[]>;
  setTasks: (sessionId: string, tasks: AgentTask[]) => void;
  select: (workspaceId: string, taskId: string | null) => void;
  dismiss: (sessionId: string, taskId: string) => void;
}

export const useAgentTasksStore = create<AgentTasksState>((set, get) => ({
  bySession: {},
  selected: {},
  dismissed: {},
  setTasks: (sessionId, tasks) => {
    const current = get().bySession[sessionId];
    if (current && JSON.stringify(current) === JSON.stringify(tasks)) return;
    set((s) => ({ bySession: { ...s.bySession, [sessionId]: tasks } }));
  },
  select: (workspaceId, taskId) =>
    set((s) => ({ selected: { ...s.selected, [workspaceId]: taskId } })),
  dismiss: (sessionId, taskId) =>
    set((s) => ({
      dismissed: { ...s.dismissed, [sessionId]: [...(s.dismissed[sessionId] ?? []), taskId] },
    })),
}));
