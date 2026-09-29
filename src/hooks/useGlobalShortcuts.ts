import { useEffect } from "react";

import { closeFileWithConfirm } from "@/actions/files";
import { startNewSession, startSessionInPickedFolder } from "@/actions/sessions";
import {
  activateWorkspaceAt,
  focusNextAttention,
  reopenClosedWorkspace,
  toggleShellPanel,
} from "@/actions/workspaces";
import { matchShortcut, matchTabNumber, type ShortcutAction } from "@/lib/shortcuts";
import { DEFAULT_FONT_SIZE, useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import { getActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";

const setFontSize = (update: (size: number) => number) => {
  const { fontSize, set } = useSettingsStore.getState();
  set({ fontSize: Math.max(9, Math.min(22, update(fontSize))) });
};

const ui = () => useUiStore.getState();

const handlers: Record<ShortcutAction, () => void> = {
  palette: () => ui().openPalette("all"),
  quickOpen: () => ui().openPalette("files"),
  searchChats: () => ui().openPalette("chats"),
  toggleSessions: () => ui().toggleSessions(),
  toggleContext: () => ui().toggleContext(),
  showSessions: () => {
    ui().setSessionsOpen(true);
    requestAnimationFrame(() => document.getElementById("sessions-search")?.focus());
  },
  showExplorer: () => ui().toggleContextView("explorer"),
  showChanges: () => ui().toggleContextView("changes"),
  showClaude: () => ui().toggleContextView("claude"),
  toggleShell: toggleShellPanel,
  newShell: () => {
    const workspace = getActiveWorkspace();
    if (workspace) useWorkspaceStore.getState().openShell(workspace.id);
  },
  newSession: () => {
    const workspace = getActiveWorkspace();
    if (workspace) startNewSession(workspace.cwd);
    else void startSessionInPickedFolder();
  },
  nextWorkspace: () => useWorkspaceStore.getState().cycle(1),
  prevWorkspace: () => useWorkspaceStore.getState().cycle(-1),
  reopenTab: reopenClosedWorkspace,
  nextAttention: focusNextAttention,
  closeFile: () => {
    const workspace = getActiveWorkspace();
    if (workspace?.activeFile) void closeFileWithConfirm(workspace.id, workspace.activeFile);
  },
  fontBigger: () => setFontSize((size) => size + 1),
  fontSmaller: () => setFontSize((size) => size - 1),
  fontReset: () => setFontSize(() => DEFAULT_FONT_SIZE),
  settings: () => ui().setSettingsOpen(true),
  shortcuts: () => ui().setShortcutsOpen(true),
};

export const runShortcut = (action: ShortcutAction) => handlers[action]();

const PALETTE_ACTIONS = new Set<ShortcutAction>(["palette", "quickOpen", "searchChats"]);

const blockedByModal = (action: ShortcutAction | null) => {
  const { confirm, renameTarget, settingsOpen, shortcutsOpen, paletteMode } = ui();
  if (confirm || renameTarget || settingsOpen || shortcutsOpen) return true;
  return !!paletteMode && !(action && PALETTE_ACTIONS.has(action));
};

export const useGlobalShortcuts = () => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tab = matchTabNumber(event);
      const action = tab ? null : matchShortcut(event);
      if ((!tab && !action) || blockedByModal(action)) return;
      event.preventDefault();
      event.stopPropagation();
      if (tab) activateWorkspaceAt(tab === 9 ? -1 : tab - 1);
      else if (action) handlers[action]();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
};
