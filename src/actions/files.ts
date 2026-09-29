import { toast } from "sonner";

import { agentName } from "@/lib/agents/registry";
import { candidatePaths, type PathLinkTarget } from "@/lib/terminal/links";
import { pasteIntoTerminal } from "@/lib/terminal/registry";
import { api } from "@/lib/tauri/commands";
import { revealInExplorer } from "@/lib/tauri/system";
import { basename, isWithin, relativePath } from "@/lib/utils";
import { useExplorerStore } from "@/stores/explorer-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { isTerminalAlive } from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { dirtyPaths, useViewerStore } from "@/stores/viewer-store";
import { findWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

export const mentionText = (path: string, root: string) => {
  const rel = relativePath(path, root).replace(/\\/g, "/");
  return /\s/.test(rel) ? `@"${rel}" ` : `@${rel} `;
};

const liveAgentTerminal = (workspace: Workspace) =>
  workspace.mode === "live" && isTerminalAlive(workspace.agentTerminalId)
    ? workspace.agentTerminalId
    : null;

export const canMention = (workspace: Workspace) => !!liveAgentTerminal(workspace);

export const sendToAgent = (workspace: Workspace, text: string) => {
  const terminalId = liveAgentTerminal(workspace);
  if (!terminalId) {
    toast(`Resume the session first to send this to ${agentName(workspace.agent)}`);
    return;
  }
  pasteIntoTerminal(terminalId, text);
};

export const mentionInAgent = (workspace: Workspace, path: string) =>
  sendToAgent(workspace, mentionText(path, workspace.cwd));

export const closeFilesWithConfirm = async (workspaceId: string, tabs: string[]) => {
  const dirty = dirtyPaths(tabs);
  if (dirty.length) {
    const confirmed = await useUiStore.getState().askConfirm({
      title:
        dirty.length === 1
          ? `Discard changes to ${basename(dirty[0])}?`
          : `Discard changes to ${dirty.length} files?`,
      description: "Your unsaved edits will be lost.",
      confirmLabel: "Discard",
      destructive: true,
    });
    if (!confirmed) return;
  }
  const { closeFile } = useWorkspaceStore.getState();
  for (const tab of tabs) closeFile(workspaceId, tab);
  useViewerStore.getState().forget(tabs);
};

export const closeFileWithConfirm = (workspaceId: string, tab: string) =>
  closeFilesWithConfirm(workspaceId, [tab]);

export const openFileAt = (workspaceId: string, path: string, line: number | null = null) => {
  useWorkspaceStore.getState().openFile(workspaceId, path);
  if (line) useViewerStore.getState().revealLine(path, line);
};

export const openTypedPath = async (workspace: Workspace, path: string) => {
  const stat = await api.statPath(path).catch(() => null);
  if (!stat) {
    toast.error(`Can't find ${path}`);
    return;
  }
  if (stat.kind === "file") {
    openFileAt(workspace.id, path);
    return;
  }
  if (!isWithin(path, workspace.cwd)) {
    void revealInExplorer(path);
    return;
  }
  const explorer = useExplorerStore.getState();
  await explorer.reveal(path, workspace.cwd);
  explorer.expand(path);
  useUiStore.getState().showContext("explorer");
};

const firstExistingFile = async (paths: string[]) => {
  for (const path of paths) {
    const stat = await api.statPath(path).catch(() => null);
    if (stat?.kind === "file") return path;
  }
  return null;
};

export const openPathFromTerminal = async (workspaceId: string, target: PathLinkTarget) => {
  const workspace = findWorkspace(workspaceId);
  if (!workspace) return;
  const recent = useSessionsStore.getState().byId[workspace.sessionId]?.recentCwds ?? [];
  const path = await firstExistingFile(candidatePaths(target.raw, [...recent, workspace.cwd]));
  if (!path) {
    toast.error(`Can't find ${target.raw}`);
    return;
  }
  openFileAt(workspaceId, path, target.line);
};
