import { toast } from "sonner";

import { agentShells, agentStartedMs } from "@/lib/agent-tasks";
import { appName } from "@/lib/hide-mode";
import { plural, samePath } from "@/lib/utils";
import { useAgentTasksStore } from "@/stores/agent-tasks-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  aliveTerminals,
  isAgentRunning,
  terminalPids,
  useTerminalStore,
} from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { dirtyPaths, useViewerStore } from "@/stores/viewer-store";
import { workspaceTerminalIds } from "@/stores/workspace-factory";
import { getActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { ShellTab, Workspace } from "@/types";

const describeRunning = (workspaces: Workspace[]) => {
  const agents = aliveTerminals(workspaces.map((w) => w.agentTerminalId));
  const shells = aliveTerminals(workspaces.flatMap((w) => w.shells.map((s) => s.id)));
  const parts = [agents && plural(agents, "running session"), shells && plural(shells, "shell")];
  return parts.filter(Boolean).join(" and ") || null;
};

const confirmLoss = async (title: string, workspaces: Workspace[], files: string[]) => {
  const running = describeRunning(workspaces);
  const dirty = dirtyPaths(files);
  if (!running && !dirty.length) return true;
  const lines = [
    running &&
      `${running} will be stopped. Conversations stay saved and you can resume them any time.`,
    dirty.length > 0 && `Unsaved changes to ${plural(dirty.length, "file")} will be lost.`,
  ];
  return useUiStore.getState().askConfirm({
    title,
    description: lines.filter(Boolean).join(" "),
    confirmLabel: running ? "Close and stop" : "Discard changes",
    destructive: true,
  });
};

const filesOnlyIn = (targets: Workspace[], others: Workspace[]) => {
  const elsewhere = others.flatMap((w) => w.openFiles);
  return targets
    .flatMap((w) => w.openFiles)
    .filter((file) => !elsewhere.some((other) => samePath(other, file)));
};

export const closeWorkspaces = async (ids: string[]) => {
  const { workspaces, close } = useWorkspaceStore.getState();
  const targets = workspaces.filter((w) => ids.includes(w.id));
  if (!targets.length) return;
  const others = workspaces.filter((w) => !ids.includes(w.id));
  const files = filesOnlyIn(targets, others);
  const title = targets.length > 1 ? `Close ${targets.length} tabs?` : "Close this session tab?";
  if (!(await confirmLoss(title, targets, files))) return;
  for (const workspace of targets) await close(workspace.id);
  useViewerStore.getState().forget(files);
  for (const workspace of targets)
    if (!others.some((w) => samePath(w.cwd, workspace.cwd)))
      useExplorerStore.getState().forget(workspace.cwd);
};

export const confirmQuit = () => {
  const { workspaces } = useWorkspaceStore.getState();
  return confirmLoss(
    `Quit ${appName(useSettingsStore.getState().hideMode)}?`,
    workspaces,
    workspaces.flatMap((w) => w.openFiles),
  );
};

export const closeOtherWorkspaces = (id: string) =>
  closeWorkspaces(
    useWorkspaceStore
      .getState()
      .workspaces.filter((w) => w.id !== id)
      .map((w) => w.id),
  );

export const closeWorkspacesToRight = (id: string) => {
  const { workspaces } = useWorkspaceStore.getState();
  const index = workspaces.findIndex((w) => w.id === id);
  return closeWorkspaces(workspaces.slice(index + 1).map((w) => w.id));
};

export const closeIdleWorkspaces = () =>
  closeWorkspaces(
    useWorkspaceStore
      .getState()
      .workspaces.filter((w) => !aliveTerminals(workspaceTerminalIds(w)))
      .map((w) => w.id),
  );

export const reopenClosedWorkspace = () => {
  const { recentlyClosed, openSession } = useWorkspaceStore.getState();
  const { byId } = useSessionsStore.getState();
  const sessionId = recentlyClosed.find((id) => byId[id]);
  if (!sessionId) {
    toast("No recently closed tabs to reopen");
    return;
  }
  useWorkspaceStore.setState({ recentlyClosed: recentlyClosed.filter((id) => id !== sessionId) });
  openSession(byId[sessionId]);
};

export const activateWorkspaceAt = (index: number) => {
  const { workspaces, activate } = useWorkspaceStore.getState();
  const target = index < 0 ? workspaces.at(-1) : workspaces[index];
  if (target) activate(target.id);
};

export const focusNextAttention = () => {
  const { workspaces, activeId, activate } = useWorkspaceStore.getState();
  const { terminals } = useTerminalStore.getState();
  const start = workspaces.findIndex((w) => w.id === activeId);
  const ordered = [...workspaces.slice(start + 1), ...workspaces.slice(0, start + 1)];
  const next = ordered.find((w) => w.agentTerminalId && terminals[w.agentTerminalId]?.attention);
  if (next) activate(next.id);
  else toast("No sessions are waiting for you");
};

export const killShellWithConfirm = async (workspaceId: string, shell: ShellTab, name: string) => {
  if (useTerminalStore.getState().terminals[shell.id]?.busy) {
    const confirmed = await useUiStore.getState().askConfirm({
      title: `Kill ${name}?`,
      description: "Something is still running in this shell. Killing it stops that process.",
      confirmLabel: "Kill shell",
      destructive: true,
    });
    if (!confirmed) return;
  }
  useWorkspaceStore.getState().closeShell(workspaceId, shell.id);
};

export const selectShell = (workspaceId: string, shellId: string) => {
  useAgentTasksStore.getState().select(workspaceId, null);
  useWorkspaceStore.getState().setActiveShell(workspaceId, shellId);
};

export const toggleShellPanel = () => {
  const workspace = getActiveWorkspace();
  if (!workspace) return;
  const { sessionId } = workspace;
  const { live } = useSessionsStore.getState();
  const started = agentStartedMs(live, terminalPids(), sessionId, isAgentRunning(workspace));
  const shells = agentShells(
    useAgentTasksStore.getState().bySession[sessionId],
    started,
    useSettingsStore.getState().hideMode,
    Date.now(),
  );
  useWorkspaceStore
    .getState()
    .setShellPanel(workspace.id, !workspace.shellPanelOpen, shells.length === 0);
};
