import { create } from "zustand";

import { omitKey } from "@/lib/utils";
import type { TerminalState } from "@/types";

interface TerminalStore {
  terminals: Record<string, TerminalState>;
  upsert: (terminal: TerminalState) => void;
  update: (id: string, patch: Partial<TerminalState>) => void;
  remove: (id: string) => void;
}

const isAlive = (terminal: TerminalState | undefined) =>
  terminal?.status === "running" || terminal?.status === "starting";

export const useTerminalStore = create<TerminalStore>((set) => ({
  terminals: {},
  upsert: (terminal) => set((s) => ({ terminals: { ...s.terminals, [terminal.id]: terminal } })),
  update: (id, patch) =>
    set((s) => {
      const current = s.terminals[id];
      if (!current) return s;
      const changed = (Object.keys(patch) as (keyof TerminalState)[]).some(
        (key) => current[key] !== patch[key],
      );
      return changed ? { terminals: { ...s.terminals, [id]: { ...current, ...patch } } } : s;
    }),
  remove: (id) => set((s) => ({ terminals: omitKey(s.terminals, id) })),
}));

export const isTerminalAlive = (id: string | null | undefined) =>
  !!id && isAlive(useTerminalStore.getState().terminals[id]);

export const aliveTerminals = (ids: (string | null)[]) => ids.filter(isTerminalAlive).length;
