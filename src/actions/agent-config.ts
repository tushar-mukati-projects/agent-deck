import { toast } from "sonner";

import { api } from "@/lib/tauri/commands";
import { failedTo, isWithin } from "@/lib/utils";
import { refreshOverview } from "@/stores/overview-store";
import { useUiStore } from "@/stores/ui-store";
import { findWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { RemovalRequest } from "@/lib/agent-config/removals";
import type { ConfigAgent, Workspace } from "@/types";

const closeTabs = (workspaceId: string, target: string) => {
  const { closeFile } = useWorkspaceStore.getState();
  for (const file of findWorkspace(workspaceId)?.openFiles ?? []) {
    if (isWithin(file, target)) closeFile(workspaceId, file);
  }
};

export const removeConfig = async (
  workspace: Workspace,
  agent: ConfigAgent,
  { removal, name, description, closes }: RemovalRequest,
) => {
  const confirmed = await useUiStore.getState().askConfirm({
    title: `Remove ${name}?`,
    description,
    confirmLabel: "Remove",
    destructive: true,
  });
  if (!confirmed) return;
  try {
    await api.removeAgentConfig(workspace.cwd, agent, removal);
  } catch (error) {
    toast.error(failedTo(`remove ${name}`, error));
    return;
  }
  if (closes) closeTabs(workspace.id, closes);
  toast.success(`Removed ${name}`);
  void refreshOverview(workspace.cwd, agent);
};
