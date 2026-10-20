import { useEffect } from "react";
import { UserAttentionType } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { toast } from "sonner";

import { sessionFileNow } from "@/hooks/useSessionFile";
import { processStart, runningSubagents } from "@/lib/agent-tasks";
import { CLAUDE } from "@/lib/agents/registry";
import { alertStatus, announcement } from "@/lib/announce";
import { playChime, unlockAudio } from "@/lib/chime";
import { speak } from "@/lib/speech";
import { onAgentIdle, type IdleEvent } from "@/lib/terminal/activity";
import { api } from "@/lib/tauri/commands";
import { appWindow, onWindowFocused } from "@/lib/tauri/system";
import { basename } from "@/lib/utils";
import { useAgentTasksStore } from "@/stores/agent-tasks-store";
import { agentName } from "@/stores/agents";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { findWorkspace, getActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

let permission: Promise<boolean> | null = null;

const notificationsAllowed = () => {
  permission ??= isPermissionGranted()
    .then((granted) => granted || requestPermission().then((result) => result === "granted"))
    .catch(() => false);
  return permission;
};

const subagentsStillRunning = async (workspace: Workspace | null) => {
  if (workspace?.agent !== CLAUDE) return false;
  const { filePath, distro } = sessionFileNow(workspace);
  if (!filePath) return false;
  try {
    const tasks = await api.sessionTasks(filePath, distro);
    useAgentTasksStore.getState().setTasks(workspace.sessionId, tasks);
    const started = processStart(useSessionsStore.getState().live, workspace.sessionId);
    return runningSubagents(tasks.agents, started).length > 0;
  } catch {
    return false;
  }
};

const handleIdle = async (event: IdleEvent) => {
  const workspace = findWorkspace(event.workspaceId);
  if (!event.needsInput && (await subagentsStillRunning(workspace))) {
    useTerminalStore.getState().update(event.terminalId, { attention: false });
    return;
  }
  const { sound, notifications, speech, voice, phonePing, phoneTopic, hideMode } =
    useSettingsStore.getState();
  if (sound && !hideMode) void playChime(event.needsInput ? "input" : "done");
  const name = agentName(workspace?.agent);
  const title = workspace?.title || basename(event.cwd);
  const body = alertStatus(name, event.needsInput);
  const focused = await appWindow.isFocused().catch(() => false);
  if (phonePing && phoneTopic && !focused)
    void api.phonePing(phoneTopic, title, body, event.needsInput).catch(() => undefined);
  if (hideMode || event.visible) return;
  if (speech) speak(announcement(title, name, event.needsInput), voice);
  if (!notifications) return;

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
  const terminalId = getActiveWorkspace()?.agentTerminalId;
  if (terminalId) useTerminalStore.getState().update(terminalId, { attention: false });
};

export const useAttentionAlerts = () => {
  useEffect(() => {
    unlockAudio();
    const unsubscribeIdle = onAgentIdle((event) => void handleIdle(event));
    const unlistenFocus = onWindowFocused(clearVisibleAttention);

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
      unlistenFocus();
    };
  }, []);
};
