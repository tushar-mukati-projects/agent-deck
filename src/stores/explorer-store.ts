import { create } from "zustand";

import { api } from "@/lib/tauri/commands";
import {
  dirname,
  errorMessage,
  filterKeys,
  isWithin,
  normalizePath,
  omitKey,
  sameJson,
} from "@/lib/utils";
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
  refresh: (root: string) => void;
  forget: (root: string) => void;
}

const key = normalizePath;
const requests = new Map<string, number>();
let lastRequest = 0;
let revealRequest = 0;

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
      sameJson(current.children[k], result.entries);
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
      expanded: filterKeys(s.expanded, (k) => !isWithin(k, root) || k === key(root)),
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

  refresh: (root) => {
    if (get().children[key(root)]) get().refreshWithin(root);
    else void get().load(root);
  },

  forget: (root) => {
    for (const k of requests.keys()) if (isWithin(k, root)) requests.delete(k);
    const outside = (k: string) => !isWithin(k, root);
    set((s) => ({
      children: filterKeys(s.children, outside),
      paths: filterKeys(s.paths, outside),
      errors: filterKeys(s.errors, outside),
      expanded: filterKeys(s.expanded, outside),
      loading: filterKeys(s.loading, outside),
      selected: s.selected && isWithin(s.selected, root) ? null : s.selected,
    }));
  },
}));
