import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ContextView, SessionInfo } from "@/types";

export type PaletteMode = "all" | "files" | "chats";

const UI_STORAGE_KEY = "agent-deck-ui";
const SESSIONS_WIDTH_PX = 280;
const CONTEXT_WIDTH_PX = 320;

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  resolve: (confirmed: boolean) => void;
}

export type SidePanel = "sessions" | "context";

export type EntryRequest =
  | { kind: "create"; workspaceId: string; root: string; dir: string; isDir: boolean }
  | { kind: "rename"; path: string; isDir: boolean };

interface UiState {
  sessionsOpen: boolean;
  sessionsWidth: number;
  contextWidth: number;
  setPanelWidth: (panel: SidePanel, width: number) => void;
  contextOpen: boolean;
  contextView: ContextView;
  subagentsOpen: boolean;
  setSubagentsOpen: (open: boolean) => void;
  paletteMode: PaletteMode | null;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  notesOpen: boolean;
  confirm: ConfirmRequest | null;
  renameTarget: SessionInfo | null;
  entryRequest: EntryRequest | null;
  setSessionsOpen: (open: boolean) => void;
  toggleSessions: () => void;
  setContextOpen: (open: boolean) => void;
  toggleContext: () => void;
  showContext: (view: ContextView) => void;
  toggleContextView: (view: ContextView) => void;
  openPalette: (mode: PaletteMode) => void;
  closePalette: () => void;
  setSettingsOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setNotesOpen: (open: boolean) => void;
  setRenameTarget: (session: SessionInfo | null) => void;
  setEntryRequest: (request: EntryRequest | null) => void;
  askConfirm: (request: Omit<ConfirmRequest, "resolve">) => Promise<boolean>;
  resolveConfirm: (confirmed: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sessionsOpen: true,
      sessionsWidth: SESSIONS_WIDTH_PX,
      contextWidth: CONTEXT_WIDTH_PX,
      setPanelWidth: (panel, width) =>
        set(panel === "sessions" ? { sessionsWidth: width } : { contextWidth: width }),
      contextOpen: true,
      contextView: "explorer",
      subagentsOpen: false,
      setSubagentsOpen: (open) => set({ subagentsOpen: open }),
      paletteMode: null,
      settingsOpen: false,
      shortcutsOpen: false,
      notesOpen: false,
      confirm: null,
      renameTarget: null,
      entryRequest: null,
      setSessionsOpen: (open) => set({ sessionsOpen: open }),
      toggleSessions: () => set((s) => ({ sessionsOpen: !s.sessionsOpen })),
      setContextOpen: (open) => set({ contextOpen: open }),
      toggleContext: () => set((s) => ({ contextOpen: !s.contextOpen })),
      showContext: (view) => set({ contextView: view, contextOpen: true }),
      toggleContextView: (view) =>
        set((s) =>
          s.contextOpen && s.contextView === view
            ? { contextOpen: false }
            : { contextView: view, contextOpen: true },
        ),
      openPalette: (mode) => set({ paletteMode: mode }),
      closePalette: () => set({ paletteMode: null }),
      setSettingsOpen: (open) => set({ settingsOpen: open }),
      setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
      setNotesOpen: (open) => set({ notesOpen: open }),
      setRenameTarget: (session) => set({ renameTarget: session }),
      setEntryRequest: (request) => set({ entryRequest: request }),
      askConfirm: (request) =>
        new Promise<boolean>((resolve) => {
          get().confirm?.resolve(false);
          set({ confirm: { ...request, resolve } });
        }),
      resolveConfirm: (confirmed) => {
        get().confirm?.resolve(confirmed);
        set({ confirm: null });
      },
    }),
    {
      name: UI_STORAGE_KEY,
      version: 2,
      partialize: (s) => ({
        sessionsOpen: s.sessionsOpen,
        sessionsWidth: s.sessionsWidth,
        contextOpen: s.contextOpen,
        contextWidth: s.contextWidth,
        contextView: s.contextView,
      }),
    },
  ),
);
