import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ContextView, SessionInfo } from "@/types";

export type PaletteMode = "all" | "files" | "chats";

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  resolve: (confirmed: boolean) => void;
}

export type SidePanel = "sessions" | "context";

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
  askConfirm: (request: Omit<ConfirmRequest, "resolve">) => Promise<boolean>;
  resolveConfirm: (confirmed: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sessionsOpen: true,
      sessionsWidth: 280,
      contextWidth: 320,
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
      name: "agent-deck-ui",
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
