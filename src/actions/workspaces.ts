import { toast } from "sonner";

import { processStart, shownTasks } from "@/lib/agent-tasks";
import { samePath } from "@/lib/utils";
import { useAgentTasksStore } from "@/stores/agent-tasks-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { aliveTerminals, isTerminalAlive, useTerminalStore } from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { dirtyPaths, useViewerStore } from "@/stores/viewer-store";
import { getActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

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
    "Quit Claude Deck?",
    workspaces,
    workspaces.flatMap((w) => w.openFiles),
  );
};

export const closeWorkspace = (id: string) => closeWorkspaces([id]);

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
      .workspaces.filter((w) => !aliveTerminals([w.agentTerminalId, ...w.shells.map((s) => s.id)]))
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

const agentShellsNow = (workspace: Workspace) => {
  const { live } = useSessionsStore.getState();
  const alive =
    (workspace.mode === "live" && isTerminalAlive(workspace.agentTerminalId)) ||
    live.some((l) => l.sessionId === workspace.sessionId);
  const { bySession, dismissed } = useAgentTasksStore.getState();
  return shownTasks(
    bySession[workspace.sessionId] ?? [],
    alive ? processStart(live, workspace.sessionId) : null,
    Date.now(),
    dismissed[workspace.sessionId],
  );
};

export const toggleShellPanel = () => {
  const workspace = getActiveWorkspace();
  if (!workspace) return;
  const open = !workspace.shellPanelOpen;
  const spawn = agentShellsNow(workspace).length === 0;
  useWorkspaceStore.getState().setShellPanel(workspace.id, open, spawn);
};
