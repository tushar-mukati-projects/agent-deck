import { create } from "zustand";

import { api } from "@/lib/tauri/commands";
import { dirname, errorMessage, isWithin, normalizePath, omitKey } from "@/lib/utils";
import type { DirEntry } from "@/types";

interface ExplorerState {
  children: Record<string, DirEntry[]>;
  paths: Record<string, string>;
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
  refreshWithin: (root: string) => void;
  forget: (root: string) => void;
}

const key = normalizePath;
const requests = new Map<string, number>();
let lastRequest = 0;
let revealRequest = 0;

const keepOutside = <T>(record: Record<string, T>, root: string) =>
  Object.fromEntries(Object.entries(record).filter(([k]) => !isWithin(k, root)));

export const useExplorerStore = create<ExplorerState>((set, get) => ({
  children: {},
  paths: {},
  errors: {},
  expanded: {},
  loading: {},
  selected: null,

  load: async (dir) => {
    const k = key(dir);
    const request = ++lastRequest;
    requests.set(k, request);
    if (!get().children[k]) set((s) => ({ loading: { ...s.loading, [k]: true } }));
    const result = await api.listDir(dir).then(
      (entries) => ({ entries }),
      (error: unknown) => ({ error: errorMessage(error) }),
    );
    if (requests.get(k) !== request) return;
    const current = get();
    const unchanged =
      "entries" in result &&
      !current.loading[k] &&
      !(k in current.errors) &&
      current.paths[k] === dir &&
      current.children[k] !== undefined &&
      JSON.stringify(current.children[k]) === JSON.stringify(result.entries);
    if (unchanged) return;
    set((s) => ({
      loading: omitKey(s.loading, k),
      ...("entries" in result
        ? {
            children: { ...s.children, [k]: result.entries },
            paths: { ...s.paths, [k]: dir },
            errors: omitKey(s.errors, k),
          }
        : { errors: { ...s.errors, [k]: result.error } }),
    }));
  },

  toggle: (dir) => (get().expanded[key(dir)] ? get().collapse(dir) : get().expand(dir)),

  expand: (dir) => {
    const k = key(dir);
    set((s) => ({ expanded: { ...s.expanded, [k]: true } }));
    if (!get().children[k]) void get().load(dir);
  },

  collapse: (dir) => set((s) => ({ expanded: omitKey(s.expanded, key(dir)) })),

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
    const request = ++revealRequest;
    const ancestors: string[] = [];
    let current = dirname(path);
    while (isWithin(current, root) && key(current) !== key(root)) {
      ancestors.unshift(current);
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
    for (const dir of [root, ...ancestors]) {
      if (request !== revealRequest) return;
      set((s) => ({ expanded: { ...s.expanded, [key(dir)]: true } }));
      if (!get().children[key(dir)]) await get().load(dir);
    }
    if (request === revealRequest) set({ selected: path });
  },

  refreshDirs: (dirs) => {
    const { children } = get();
    for (const dir of dirs) if (children[key(dir)]) void get().load(dir);
  },

  refreshWithin: (root) => {
    const { paths } = get();
    for (const [k, path] of Object.entries(paths)) if (isWithin(k, root)) void get().load(path);
  },

  forget: (root) => {
    for (const k of requests.keys()) if (isWithin(k, root)) requests.delete(k);
    set((s) => ({
      children: keepOutside(s.children, root),
      paths: keepOutside(s.paths, root),
      errors: keepOutside(s.errors, root),
      expanded: keepOutside(s.expanded, root),
      loading: keepOutside(s.loading, root),
      selected: s.selected && isWithin(s.selected, root) ? null : s.selected,
    }));
  },
}));
