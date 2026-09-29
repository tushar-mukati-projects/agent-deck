import { toast } from "sonner";

import { isPersisted, type LaunchOptions } from "@/lib/agents/launch";
import { externalLive } from "@/lib/sessions";
import { api } from "@/lib/tauri/commands";
import { pickFolder } from "@/lib/tauri/system";
import { errorMessage } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { isTerminalAlive, useTerminalStore } from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { findWorkspace, findWorkspaceBySession, useWorkspaceStore } from "@/stores/workspace-store";
import type { AgentId, SessionInfo } from "@/types";

const promptLabel = (count: number) => `${count} ${count === 1 ? "prompt" : "prompts"}`;

const openElsewhere = (sessionId: string) => {
  const { live } = useSessionsStore.getState();
  return (
    externalLive(live, useTerminalStore.getState().terminals).find(
      (l) => l.sessionId === sessionId,
    ) ?? null
  );
};

const confirmOpenElsewhere = async (sessionId: string) => {
  const live = openElsewhere(sessionId);
  if (!live) return true;
  return useUiStore.getState().askConfirm({
    title: "This session is already open elsewhere",
    description: `It's running in another terminal${live.distro ? ` in WSL ${live.distro}` : ""} (PID ${live.pid}). Resuming here too means two copies writing to the same conversation. Fork it instead to branch off safely.`,
    confirmLabel: "Resume anyway",
    destructive: true,
  });
};

export const previewSession = (session: SessionInfo) =>
  useWorkspaceStore.getState().openSession(session);

export const resumeWorkspace = async (workspaceId: string, options: LaunchOptions = {}) => {
  const workspace = findWorkspace(workspaceId);
  if (!workspace) return;
  if (options.fork && !isPersisted(workspace)) {
    toast.error("Nothing to fork yet — send a prompt in this session first.");
    return;
  }
  if (
    !options.fork &&
    workspace.mode !== "live" &&
    !(await confirmOpenElsewhere(workspace.sessionId))
  )
    return;
  useWorkspaceStore.getState().launch(workspaceId, options);
};

export const resumeSession = async (session: SessionInfo, options: LaunchOptions = {}) =>
  resumeWorkspace(previewSession(session), options);

export const openSessionByClick = (session: SessionInfo) =>
  useSettingsStore.getState().clickBehavior === "resume"
    ? void resumeSession(session)
    : previewSession(session);

export const startNewSession = (cwd: string, agent?: AgentId) =>
  useWorkspaceStore
    .getState()
    .newSession(cwd, { agent: agent ?? useSettingsStore.getState().defaultAgent });

export const startSessionInPickedFolder = async (defaultPath?: string, agent?: AgentId) => {
  const folder = await pickFolder(defaultPath);
  if (folder) startNewSession(folder, agent);
};

export const startAgentSession = (cwd: string, subagent: string) =>
  useWorkspaceStore.getState().newSession(cwd, { subagent });

export const renameSession = (session: SessionInfo) =>
  useUiStore.getState().setRenameTarget(session);

export const deleteSessionWithConfirm = async (session: SessionInfo) => {
  const workspace = findWorkspaceBySession(session.id);
  if (workspace && isTerminalAlive(workspace.agentTerminalId)) {
    toast.error("This session is running here. Close its tab first.");
    return;
  }
  if (useSessionsStore.getState().live.some((l) => l.sessionId === session.id)) {
    toast.error("This session is open in another terminal. Close it there first.");
    return;
  }
  const confirmed = await useUiStore.getState().askConfirm({
    title: `Delete “${session.title ?? "Untitled session"}”?`,
    description: session.distro
      ? `This permanently deletes the conversation (${promptLabel(session.promptCount)}) from WSL ${session.distro}. It can't be undone.`
      : `The conversation (${promptLabel(session.promptCount)}) and its history files will be moved to the Recycle Bin.`,
    confirmLabel: session.distro ? "Delete permanently" : "Move to Recycle Bin",
    destructive: true,
  });
  if (!confirmed) return;
  try {
    await api.deleteSession(session.filePath, session.distro);
    if (workspace) await useWorkspaceStore.getState().close(workspace.id);
    useSessionsStore.getState().removeSession(session.id);
    useSettingsStore.getState().forgetSession(session.id);
    toast.success(session.distro ? "Session deleted" : "Session moved to the Recycle Bin");
  } catch (error) {
    toast.error(errorMessage(error));
  }
};
