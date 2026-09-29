import { toast } from "sonner";

import { isTerminalAlive, useTerminalStore } from "@/stores/terminal-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useUiStore } from "@/stores/ui-store";
import { getActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

const runningTerminals = (workspace: Workspace) => ({
  claude: isTerminalAlive(workspace.agentTerminalId),
  shells: workspace.shells.filter((s) => isTerminalAlive(s.id)).length,
});

const describeRunning = (workspaces: Workspace[]) => {
  const totals = workspaces
    .map(runningTerminals)
    .reduce(
      (acc, r) => ({ claude: acc.claude + Number(r.claude), shells: acc.shells + r.shells }),
      { claude: 0, shells: 0 },
    );
  const parts = [
    totals.claude && `${totals.claude} Claude session${totals.claude > 1 ? "s" : ""}`,
    totals.shells && `${totals.shells} shell${totals.shells > 1 ? "s" : ""}`,
  ].filter(Boolean);
  return parts.length ? parts.join(" and ") : null;
};

export const closeWorkspaces = async (ids: string[]) => {
  const { workspaces, close } = useWorkspaceStore.getState();
  const targets = workspaces.filter((w) => ids.includes(w.id));
  if (!targets.length) return;
  const running = describeRunning(targets);
  if (running) {
    const confirmed = await useUiStore.getState().askConfirm({
      title: targets.length > 1 ? `Close ${targets.length} tabs?` : "Close this session tab?",
      description: `${running} will be stopped. Conversations stay saved and you can resume them any time.`,
      confirmLabel: "Close and stop",
      destructive: true,
    });
    if (!confirmed) return;
  }
  for (const workspace of targets) await close(workspace.id);
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
      .workspaces.filter(
        (w) => !isTerminalAlive(w.agentTerminalId) && !w.shells.some((s) => isTerminalAlive(s.id)),
      )
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

export const toggleShellPanel = () => {
  const workspace = getActiveWorkspace();
  if (workspace)
    useWorkspaceStore.getState().setShellPanel(workspace.id, !workspace.shellPanelOpen);
};
