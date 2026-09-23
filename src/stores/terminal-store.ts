import { create } from "zustand";

import type { TerminalState } from "@/types";

interface TerminalStore {
  terminals: Record<string, TerminalState>;
  upsert: (terminal: TerminalState) => void;
  update: (id: string, patch: Partial<TerminalState>) => void;
  remove: (id: string) => void;
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  terminals: {},
  upsert: (terminal) => set((s) => ({ terminals: { ...s.terminals, [terminal.id]: terminal } })),
  update: (id, patch) =>
    set((s) => {
      const current = s.terminals[id];
      if (!current) return s;
      const changed = Object.entries(patch).some(
        ([key, value]) => current[key as keyof TerminalState] !== value,
      );
      return changed ? { terminals: { ...s.terminals, [id]: { ...current, ...patch } } } : s;
    }),
  remove: (id) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.terminals;
      return { terminals: rest };
    }),
}));
