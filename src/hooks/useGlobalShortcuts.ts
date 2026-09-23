import { useEffect } from "react";

import { closeFileWithConfirm } from "@/features/viewer/FileViewer";
import { matchShortcut, type ShortcutAction } from "@/lib/shortcuts";
import { DEFAULT_FONT_SIZE, useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { startSessionInPickedFolder } from "@/features/titlebar/NewSessionMenu";

const activeWorkspace = () => {
  const { workspaces, activeId } = useWorkspaceStore.getState();
  return workspaces.find((w) => w.id === activeId) ?? null;
};

const setFontSize = (update: (size: number) => number) => {
  const { fontSize, set } = useSettingsStore.getState();
  set({ fontSize: Math.max(9, Math.min(22, update(fontSize))) });
};

const handlers: Record<ShortcutAction, () => void> = {
  palette: () => useUiStore.getState().openPalette("all"),
  quickOpen: () => useUiStore.getState().openPalette("files"),
  toggleSidebar: () => useUiStore.getState().toggleSidebar(),
  showSessions: () => useUiStore.getState().setSidebarView("sessions"),
  showExplorer: () => useUiStore.getState().setSidebarView("explorer"),
  showChanges: () => useUiStore.getState().setSidebarView("changes"),
  toggleShell: () => {
    const workspace = activeWorkspace();
    if (workspace) useWorkspaceStore.getState().setShellPanel(workspace.id, !workspace.shellPanelOpen);
  },
  newShell: () => {
    const workspace = activeWorkspace();
    if (workspace) useWorkspaceStore.getState().openShell(workspace.id);
  },
  newSession: () => {
    const workspace = activeWorkspace();
    if (workspace) useWorkspaceStore.getState().newSession(workspace.cwd);
    else void startSessionInPickedFolder();
  },
  nextWorkspace: () => useWorkspaceStore.getState().cycle(1),
  prevWorkspace: () => useWorkspaceStore.getState().cycle(-1),
  closeFile: () => {
    const workspace = activeWorkspace();
    if (workspace?.activeFile) void closeFileWithConfirm(workspace.id, workspace.activeFile);
  },
  fontBigger: () => setFontSize((size) => size + 1),
  fontSmaller: () => setFontSize((size) => size - 1),
  fontReset: () => setFontSize(() => DEFAULT_FONT_SIZE),
  settings: () => useUiStore.getState().setSettingsOpen(true),
};

export const useGlobalShortcuts = () => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = matchShortcut(event);
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      handlers[action]();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
};
