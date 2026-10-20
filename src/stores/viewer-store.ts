import { create } from "zustand";

import { filterKeys, normalizePath, omitKey } from "@/lib/utils";

export type MarkdownMode = "preview" | "source";

interface ViewerState {
  drafts: Record<string, string>;
  editing: Record<string, true>;
  markdownMode: Record<string, MarkdownMode>;
  lines: Record<string, number>;
  setDraft: (path: string, text: string | null) => void;
  setEditing: (path: string, editing: boolean) => void;
  setMarkdownMode: (path: string, mode: MarkdownMode) => void;
  revealLine: (path: string, line: number) => void;
  takeLine: (path: string) => number | null;
  forget: (paths: string[]) => void;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  drafts: {},
  editing: {},
  markdownMode: {},
  lines: {},
  revealLine: (path, line) => set((s) => ({ lines: { ...s.lines, [normalizePath(path)]: line } })),
  takeLine: (path) => {
    const key = normalizePath(path);
    const line = get().lines[key] ?? null;
    if (line !== null) set((s) => ({ lines: omitKey(s.lines, key) }));
    return line;
  },
  setDraft: (path, text) =>
    set((s) => ({
      drafts:
        text === null
          ? omitKey(s.drafts, normalizePath(path))
          : { ...s.drafts, [normalizePath(path)]: text },
    })),
  setEditing: (path, editing) =>
    set((s) => ({
      editing: editing
        ? { ...s.editing, [normalizePath(path)]: true }
        : omitKey(s.editing, normalizePath(path)),
    })),
  setMarkdownMode: (path, mode) =>
    set((s) => ({ markdownMode: { ...s.markdownMode, [normalizePath(path)]: mode } })),
  forget: (paths) =>
    set((s) => {
      const keys = new Set(paths.map(normalizePath));
      const kept = (k: string) => !keys.has(k);
      return {
        drafts: filterKeys(s.drafts, kept),
        editing: filterKeys(s.editing, kept),
        markdownMode: filterKeys(s.markdownMode, kept),
        lines: filterKeys(s.lines, kept),
      };
    }),
}));

export const isDirty = (path: string) => normalizePath(path) in useViewerStore.getState().drafts;

export const dirtyPaths = (paths: string[]) => paths.filter(isDirty);
