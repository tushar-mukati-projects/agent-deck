import { toast } from "sonner";

import { showError } from "@/components/ui/feedback";
import { CLAUDE, SUBAGENT_NAME } from "@/lib/agents/registry";
import { openElsewhere, sessionTitle } from "@/lib/sessions";
import { api } from "@/lib/tauri/commands";
import { pickFolder } from "@/lib/tauri/system";
import { failedTo, plural } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { isTerminalAlive, terminalPids } from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { useViewerStore } from "@/stores/viewer-store";
import { workspaceFromSession } from "@/stores/workspace-factory";
import { findWorkspace, findWorkspaceBySession, useWorkspaceStore } from "@/stores/workspace-store";
import type { AgentId, LiveSession, SessionInfo } from "@/types";

type ResumeOptions = {
  fork?: boolean;
  takeOver?: boolean;
};

const confirmTakeOver = (live: LiveSession) =>
  useUiStore.getState().askConfirm({
    title: "This session is already open elsewhere",
    description: `It's running in another terminal${live.distro ? ` in WSL ${live.distro}` : ""} (PID ${live.pid}). Close it there and resume it here, so only one copy writes to the conversation. Fork it instead to keep both.`,
    confirmLabel: "Close it there and resume here",
    destructive: true,
  });

const closeElsewhere = async (live: LiveSession) => {
  try {
    await api.terminateLiveSession(live);
    await useSessionsStore.getState().refreshLive();
    return true;
  } catch (error) {
    toast.error(failedTo("close the other copy", error));
    return false;
  }
};

const claimSession = async (sessionId: string, takeOver = false) => {
  const live = openElsewhere(useSessionsStore.getState().live, terminalPids(), sessionId);
  if (!live) return true;
  if (!takeOver && !(await confirmTakeOver(live))) return false;
  return closeElsewhere(live);
};

export const previewSession = (session: SessionInfo) =>
  useWorkspaceStore.getState().openSession(session);

export const resumeWorkspace = async (workspaceId: string, options: ResumeOptions = {}) => {
  const workspace = findWorkspace(workspaceId);
  if (!workspace) return;
  if (options.fork) {
    useWorkspaceStore.getState().fork(workspace);
    return;
  }
  if (workspace.mode !== "live" && !(await claimSession(workspace.sessionId, options.takeOver)))
    return;
  useWorkspaceStore.getState().launch(workspaceId);
};

const restartsInFlight = new Set<string>();

export const restartWorkspaceAgent = async (workspaceId: string) => {
  const workspace = findWorkspace(workspaceId);
  if (!workspace || restartsInFlight.has(workspaceId)) return;
  restartsInFlight.add(workspaceId);
  try {
    if (parseWslPath(workspace.cwd)) await useSessionsStore.getState().refreshWsl();
    if (await claimSession(workspace.sessionId))
      useWorkspaceStore.getState().restartAgent(workspaceId);
  } finally {
    restartsInFlight.delete(workspaceId);
  }
};

export const resumeSession = async (session: SessionInfo) =>
  resumeWorkspace(previewSession(session));

export const forkSession = (session: SessionInfo) =>
  useWorkspaceStore
    .getState()
    .fork(findWorkspaceBySession(session.id) ?? workspaceFromSession(session));

export const openSessionByClick = (session: SessionInfo) =>
  useSettingsStore.getState().clickBehavior === "resume"
    ? void resumeSession(session)
    : previewSession(session);

export const startNewSession = (cwd: string, agent?: AgentId) =>
  useWorkspaceStore
    .getState()
    .newSession(cwd, { agent: agent ?? useSettingsStore.getState().defaultAgent });

export const startSessionInPickedFolder = async (defaultPath?: string) => {
  const folder = await pickFolder(defaultPath);
  if (folder) startNewSession(folder);
};

export const startAgentSession = (cwd: string, subagent: string) => {
  if (!SUBAGENT_NAME.test(subagent)) {
    toast.error(`“${subagent}” isn't a valid agent name.`);
    return;
  }
  useWorkspaceStore.getState().newSession(cwd, { subagent });
};

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
    title: `Delete “${sessionTitle(session)}”?`,
    description: session.distro
      ? `This permanently deletes the conversation (${plural(session.promptCount, "prompt")}) from WSL ${session.distro}. It can't be undone.`
      : `The conversation (${plural(session.promptCount, "prompt")}) and its history files will be moved to the Recycle Bin.`,
    confirmLabel: session.distro ? "Delete permanently" : "Move to Recycle Bin",
    destructive: true,
  });
  if (!confirmed) return;
  try {
    await api.deleteSession(session.filePath, session.distro);
    if (workspace) {
      await useWorkspaceStore.getState().close(workspace.id);
      useViewerStore.getState().forget(workspace.openFiles);
    }
    useSessionsStore.getState().removeSession(session.id);
    useSettingsStore.getState().forgetSession(session.id);
    toast.success(session.distro ? "Session deleted" : "Session moved to the Recycle Bin");
  } catch (error) {
    showError(error);
  }
};

export const renameSession = async (session: SessionInfo, title: string) => {
  try {
    if (session.agent === CLAUDE) await api.renameSession(session.filePath, session.distro, title);
    else useSettingsStore.getState().setSessionTitle(session.id, title);
    const sessions = useSessionsStore.getState();
    sessions.patchSession(session.id, { title });
    void (session.distro ? sessions.refreshWsl() : sessions.refresh());
    return true;
  } catch (error) {
    toast.error(failedTo("rename", error));
    return false;
  }
};

export const refreshAll = async () => {
  const sessions = useSessionsStore.getState();
  await Promise.all([sessions.refresh(), sessions.refreshWsl()]);
};
