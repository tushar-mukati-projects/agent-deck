import { useTerminalStore } from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const isRunning = (id: string | null) => {
  if (!id) return false;
  const status = useTerminalStore.getState().terminals[id]?.status;
  return status === "running" || status === "starting";
};

export const closeWorkspaceWithConfirm = async (workspaceId: string) => {
  const { workspaces, close } = useWorkspaceStore.getState();
  const workspace = workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return;
  const runningShells = workspace.shells.filter((s) => isRunning(s.id)).length;
  if (isRunning(workspace.claudeTerminalId) || runningShells > 0) {
    const confirmed = await useUiStore.getState().askConfirm({
      title: "Close this session tab?",
      description: isRunning(workspace.claudeTerminalId)
        ? "Claude is still running here. Closing stops the process — the conversation stays saved and you can resume it any time."
        : `${runningShells} shell${runningShells > 1 ? "s are" : " is"} still running and will be stopped.`,
      confirmLabel: "Close and stop",
      destructive: true,
    });
    if (!confirmed) return;
  }
  await close(workspaceId);
};
