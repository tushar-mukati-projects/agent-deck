import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ContextView, SessionInfo } from "@/types";

export type PaletteMode = "all" | "files" | "commands" | "chats";

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  resolve: (confirmed: boolean) => void;
}

interface UiState {
  sessionsOpen: boolean;
  contextOpen: boolean;
  contextView: ContextView;
  paletteMode: PaletteMode | null;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
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
  setRenameTarget: (session: SessionInfo | null) => void;
  askConfirm: (request: Omit<ConfirmRequest, "resolve">) => Promise<boolean>;
  resolveConfirm: (confirmed: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set, get) => ({
      sessionsOpen: true,
      contextOpen: true,
      contextView: "explorer",
      paletteMode: null,
      settingsOpen: false,
      shortcutsOpen: false,
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
      name: "claude-deck-ui",
      partialize: (s) => ({
        sessionsOpen: s.sessionsOpen,
        contextOpen: s.contextOpen,
        contextView: s.contextView,
      }),
    },
  ),
);
