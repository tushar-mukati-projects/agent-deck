import { useEffect } from "react";
import { UserAttentionType } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { toast } from "sonner";

import { agentName } from "@/lib/agents/registry";
import { playChime, unlockAudio } from "@/lib/chime";
import { onAgentIdle, type IdleEvent } from "@/lib/terminal/activity";
import { api } from "@/lib/tauri/commands";
import { appWindow } from "@/lib/tauri/system";
import { basename } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { findWorkspace, getActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";

let permission: Promise<boolean> | null = null;

const notificationsAllowed = () => {
  permission ??= isPermissionGranted()
    .then((granted) => granted || requestPermission().then((result) => result === "granted"))
    .catch(() => false);
  return permission;
};

const handleIdle = async (event: IdleEvent) => {
  const { sound, notifications, hideMode } = useSettingsStore.getState();
  if (hideMode) return;
  if (sound) void playChime(event.needsInput ? "input" : "done");
  if (event.visible || !notifications) return;
  const workspace = findWorkspace(event.workspaceId);
  const name = agentName(workspace?.agent);
  const title = event.needsInput ? `${name} needs your approval` : `${name} finished`;
  const body = workspace ? `${workspace.title} · ${basename(workspace.cwd)}` : basename(event.cwd);

  if (!(await appWindow.isFocused().catch(() => false))) {
    void appWindow.requestUserAttention(UserAttentionType.Informational).catch(() => undefined);
    if (await notificationsAllowed()) sendNotification({ title, body });
    return;
  }
  toast(title, {
    description: body,
    action: workspace
      ? { label: "Open", onClick: () => useWorkspaceStore.getState().activate(workspace.id) }
      : undefined,
  });
};

const clearVisibleAttention = () => {
  const terminalId = getActiveWorkspace()?.agentTerminalId;
  if (terminalId) useTerminalStore.getState().update(terminalId, { attention: false });
};

export const useAttentionAlerts = () => {
  useEffect(() => {
    unlockAudio();
    const unsubscribeIdle = onAgentIdle((event) => void handleIdle(event));
    const unlistenFocus = appWindow.onFocusChanged(
      ({ payload: focused }) => focused && clearVisibleAttention(),
    );

    let badge = false;
    const syncBadge = () => {
      const waiting =
        !useSettingsStore.getState().hideMode &&
        Object.values(useTerminalStore.getState().terminals).some((t) => t.attention);
      if (waiting === badge) return;
      badge = waiting;
      void api.setAttentionBadge(waiting).catch(() => undefined);
    };
    const unsubscribeTerminals = useTerminalStore.subscribe(syncBadge);
    const unsubscribeSettings = useSettingsStore.subscribe(syncBadge);
    const unsubscribeWorkspaces = useWorkspaceStore.subscribe((state, previous) => {
      if (state.activeId !== previous.activeId) clearVisibleAttention();
    });

    return () => {
      unsubscribeIdle();
      unsubscribeTerminals();
      unsubscribeSettings();
      unsubscribeWorkspaces();
      void unlistenFocus.then((fn) => fn());
    };
  }, []);
};
