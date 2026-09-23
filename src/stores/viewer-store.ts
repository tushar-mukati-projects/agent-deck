import { create } from "zustand";

import { normalizePath } from "@/lib/utils";

export type MarkdownMode = "preview" | "source";

interface ViewerState {
  drafts: Record<string, string>;
  editing: Record<string, true>;
  markdownMode: Record<string, MarkdownMode>;
  setDraft: (path: string, text: string | null) => void;
  setEditing: (path: string, editing: boolean) => void;
  setMarkdownMode: (path: string, mode: MarkdownMode) => void;
}

const omit = <T>(record: Record<string, T>, key: string) => {
  const { [key]: _removed, ...rest } = record;
  return rest;
};

export const useViewerStore = create<ViewerState>((set) => ({
  drafts: {},
  editing: {},
  markdownMode: {},
  setDraft: (path, text) =>
    set((s) => ({
      drafts:
        text === null
          ? omit(s.drafts, normalizePath(path))
          : { ...s.drafts, [normalizePath(path)]: text },
    })),
  setEditing: (path, editing) =>
    set((s) => ({
      editing: editing
        ? { ...s.editing, [normalizePath(path)]: true }
        : omit(s.editing, normalizePath(path)),
    })),
  setMarkdownMode: (path, mode) =>
    set((s) => ({ markdownMode: { ...s.markdownMode, [normalizePath(path)]: mode } })),
}));

export const isDirty = (path: string) => normalizePath(path) in useViewerStore.getState().drafts;
