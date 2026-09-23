import { useEffect } from "react";
import { UserAttentionType } from "@tauri-apps/api/window";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { toast } from "sonner";

import { playChime } from "@/lib/chime";
import { api } from "@/lib/tauri/commands";
import { appWindow } from "@/lib/tauri/system";
import { onClaudeIdle, type IdleEvent } from "@/lib/terminal/registry";
import { basename } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

let permission: Promise<boolean> | null = null;

const notificationsAllowed = () => {
  permission ??= isPermissionGranted()
    .then((granted) => granted || requestPermission().then((result) => result === "granted"))
    .catch(() => false);
  return permission;
};

const describe = (event: IdleEvent) => {
  const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === event.spec.workspaceId);
  return {
    workspace,
    title: event.needsInput ? "Claude needs your approval" : "Claude finished",
    body: workspace ? `${workspace.title} · ${basename(workspace.cwd)}` : basename(event.spec.cwd),
  };
};

const handleIdle = async (event: IdleEvent) => {
  const settings = useSettingsStore.getState();
  if (event.visible || !settings.notifications) return;
  const { workspace, title, body } = describe(event);
  if (settings.sound) playChime(event.needsInput ? "input" : "done");

  const focused = await appWindow.isFocused().catch(() => false);
  if (!focused) {
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
  const { workspaces, activeId } = useWorkspaceStore.getState();
  const active = workspaces.find((w) => w.id === activeId);
  const terminalId = active?.claudeTerminalId;
  if (terminalId) useTerminalStore.getState().update(terminalId, { attention: false });
};

export const useAttentionAlerts = () => {
  useEffect(() => {
    const unsubscribeIdle = onClaudeIdle((event) => void handleIdle(event));
    const unlistenFocus = appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) clearVisibleAttention();
    });

    let badge = false;
    const syncBadge = () => {
      const waiting = Object.values(useTerminalStore.getState().terminals).some((t) => t.attention);
      if (waiting === badge) return;
      badge = waiting;
      void api.setAttentionBadge(waiting).catch(() => undefined);
    };
    const unsubscribeTerminals = useTerminalStore.subscribe(syncBadge);
    const unsubscribeWorkspaces = useWorkspaceStore.subscribe((state, previous) => {
      if (state.activeId !== previous.activeId) clearVisibleAttention();
    });

    return () => {
      unsubscribeIdle();
      unsubscribeTerminals();
      unsubscribeWorkspaces();
      void unlistenFocus.then((fn) => fn());
    };
  }, []);
};
