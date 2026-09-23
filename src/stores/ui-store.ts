import { create } from "zustand";

import type { SessionInfo, SidebarView } from "@/types";

export type PaletteMode = "all" | "files" | "commands" | "chats";

interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  resolve: (confirmed: boolean) => void;
}

interface UiState {
  sidebarView: SidebarView;
  sidebarOpen: boolean;
  paletteMode: PaletteMode | null;
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  confirm: ConfirmRequest | null;
  renameTarget: SessionInfo | null;
  setSidebarView: (view: SidebarView) => void;
  toggleSidebar: () => void;
  openPalette: (mode: PaletteMode) => void;
  closePalette: () => void;
  setSettingsOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setRenameTarget: (session: SessionInfo | null) => void;
  askConfirm: (request: Omit<ConfirmRequest, "resolve">) => Promise<boolean>;
  resolveConfirm: (confirmed: boolean) => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarView: "sessions",
  sidebarOpen: true,
  paletteMode: null,
  settingsOpen: false,
  shortcutsOpen: false,
  confirm: null,
  renameTarget: null,
  setSidebarView: (view) => set({ sidebarView: view, sidebarOpen: true }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
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
}));
