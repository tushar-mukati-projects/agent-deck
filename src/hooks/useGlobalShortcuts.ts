import { useEffect } from "react";

import { closeFilesWithConfirm } from "@/actions/files";
import { toggleHideMode } from "@/actions/hide-mode";
import { toggleNotes } from "@/actions/notes";
import { startNewSession, startSessionInPickedFolder } from "@/actions/sessions";
import {
  activateWorkspaceAt,
  focusNextAttention,
  reopenClosedWorkspace,
  toggleShellPanel,
} from "@/actions/workspaces";
import { matchShortcut, matchTabNumber, type ShortcutAction } from "@/lib/shortcuts";
import {
  DEFAULT_FONT_SIZE,
  MAX_FONT_SIZE_PX,
  MIN_FONT_SIZE_PX,
  useSettingsStore,
} from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import { getActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";

const setFontSize = (update: (size: number) => number) => {
  const { fontSize, set } = useSettingsStore.getState();
  set({ fontSize: Math.max(MIN_FONT_SIZE_PX, Math.min(MAX_FONT_SIZE_PX, update(fontSize))) });
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
  showAgentConfig: () => ui().toggleContextView("agent"),
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
    if (workspace?.activeFile) void closeFilesWithConfirm(workspace.id, [workspace.activeFile]);
  },
  fontBigger: () => setFontSize((size) => size + 1),
  fontSmaller: () => setFontSize((size) => size - 1),
  fontReset: () => setFontSize(() => DEFAULT_FONT_SIZE),
  settings: () => ui().setSettingsOpen(true),
  shortcuts: () => ui().setShortcutsOpen(true),
  notes: toggleNotes,
  toggleHideMode,
};

export const runShortcut = (action: ShortcutAction) => handlers[action]();

const PALETTE_ACTIONS = new Set<ShortcutAction>(["palette", "quickOpen", "searchChats"]);

const blockedByModal = (action: ShortcutAction | null) => {
  if (action === "toggleHideMode") return false;
  const { confirm, renameTarget, settingsOpen, shortcutsOpen, notesOpen, paletteMode } = ui();
  if (confirm || renameTarget || settingsOpen || shortcutsOpen) return true;
  if (notesOpen) return action !== "notes";
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
