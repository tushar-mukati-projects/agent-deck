import { create } from "zustand";

import { api } from "@/lib/tauri/commands";
import { dirname, errorMessage, isWithin, normalizePath } from "@/lib/utils";
import type { DirEntry } from "@/types";

interface ExplorerState {
  children: Record<string, DirEntry[]>;
  errors: Record<string, string>;
  expanded: Record<string, true>;
  loading: Record<string, true>;
  selected: string | null;
  load: (dir: string) => Promise<void>;
  toggle: (dir: string) => void;
  expand: (dir: string) => void;
  collapse: (dir: string) => void;
  collapseAll: (root: string) => void;
  select: (path: string | null) => void;
  reveal: (path: string, root: string) => Promise<void>;
  refreshDirs: (dirs: string[]) => void;
}

const key = normalizePath;

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  children: {},
  errors: {},
  expanded: {},
  loading: {},
  selected: null,

  load: async (dir) => {
    const k = key(dir);
    set((s) => ({ loading: { ...s.loading, [k]: true } }));
    try {
      const entries = await api.listDir(dir);
      set((s) => {
        const { [k]: _error, ...errors } = s.errors;
        return { children: { ...s.children, [k]: entries }, errors };
      });
    } catch (error) {
      set((s) => ({ errors: { ...s.errors, [k]: errorMessage(error) } }));
    } finally {
      set((s) => {
        const { [k]: _done, ...loading } = s.loading;
        return { loading };
      });
    }
  },

  toggle: (dir) => (get().expanded[key(dir)] ? get().collapse(dir) : get().expand(dir)),

  expand: (dir) => {
    const k = key(dir);
    set((s) => ({ expanded: { ...s.expanded, [k]: true } }));
    if (!get().children[k]) void get().load(dir);
  },

  collapse: (dir) =>
    set((s) => {
      const { [key(dir)]: _collapsed, ...expanded } = s.expanded;
      return { expanded };
    }),

  collapseAll: (root) =>
    set((s) => ({
      expanded: Object.fromEntries(
        Object.keys(s.expanded)
          .filter((k) => !isWithin(k, root) || k === key(root))
          .map((k) => [k, true as const]),
      ),
    })),

  select: (path) => set({ selected: path }),

  reveal: async (path, root) => {
    const ancestors: string[] = [];
    let current = dirname(path);
    while (isWithin(current, root) && key(current) !== key(root)) {
      ancestors.unshift(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    for (const dir of [root, ...ancestors]) {
      set((s) => ({ expanded: { ...s.expanded, [key(dir)]: true } }));
      if (!get().children[key(dir)]) await get().load(dir);
    }
    set({ selected: path });
  },

  refreshDirs: (dirs) => {
    const { children } = get();
    for (const dir of dirs) if (children[key(dir)]) void get().load(dir);
  },
}));
