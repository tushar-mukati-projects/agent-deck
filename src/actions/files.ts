import { toast } from "sonner";

import { showError } from "@/components/ui/feedback";
import { candidatePaths, type PathLinkTarget } from "@/lib/terminal/links";
import { pasteIntoTerminal } from "@/lib/terminal/registry";
import { api } from "@/lib/tauri/commands";
import { revealInExplorer } from "@/lib/tauri/system";
import { basename, failedTo, isWithin, normalizePath, relativePath } from "@/lib/utils";
import { agentName } from "@/stores/agents";
import { useExplorerStore } from "@/stores/explorer-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { isAgentRunning } from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { dirtyPaths, useViewerStore } from "@/stores/viewer-store";
import { findWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { FileContent, Workspace } from "@/types";

export type TextContent = Extract<FileContent, { kind: "text" }>;
export type Reload = (quiet?: boolean) => Promise<void>;

const saving = new Set<string>();

export const mentionText = (path: string, root: string) => {
  const rel = relativePath(path, root).replace(/\\/g, "/");
  return /\s/.test(rel) ? `@"${rel}" ` : `@${rel} `;
};

const liveAgentTerminal = (workspace: Workspace) =>
  isAgentRunning(workspace) ? workspace.agentTerminalId : null;

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

const confirmDiscard = (path: string) =>
  useUiStore.getState().askConfirm({
    title: `Discard changes to ${basename(path)}?`,
    description: "Reloading replaces your unsaved edits with the file on disk.",
    confirmLabel: "Discard and reload",
    destructive: true,
  });

const confirmOverwrite = (path: string) =>
  useUiStore.getState().askConfirm({
    title: `Overwrite ${basename(path)}?`,
    description:
      "The file changed on disk after you started editing. Saving replaces those changes with yours.",
    confirmLabel: "Overwrite",
    destructive: true,
  });

export const saveFile = async (path: string, base: TextContent, reload: Reload) => {
  const key = normalizePath(path);
  const current = useViewerStore.getState().drafts[key];
  if (current === undefined || base.encoding === "lossy" || saving.has(key)) return;
  saving.add(key);
  try {
    const write = (expectedModifiedMs: number | null) =>
      api.writeFile(path, current, { encoding: base.encoding, expectedModifiedMs });
    const outcome = await write(base.modifiedMs);
    if (outcome.kind === "conflict") {
      if (!(await confirmOverwrite(path))) return;
      await write(null);
    }
    await reload(true);
    if (useViewerStore.getState().drafts[key] === current)
      useViewerStore.getState().setDraft(path, null);
    toast.success(`Saved ${basename(path)}`);
  } catch (error) {
    toast.error(failedTo("save", error));
  } finally {
    saving.delete(key);
  }
};

export const discardAndReload = async (path: string, reload: Reload) => {
  useViewerStore.getState().setDraft(path, null);
  await reload(true);
};

export const reloadWithConfirm = async (path: string, dirty: boolean, reload: Reload) => {
  if (!dirty) return reload();
  if (await confirmDiscard(path)) await discardAndReload(path, reload);
};

const openFileAt = (workspaceId: string, path: string, line: number | null = null) => {
  useWorkspaceStore.getState().openFile(workspaceId, path);
  if (line) useViewerStore.getState().revealLine(path, line);
};

export const openTypedPath = async (workspace: Workspace, path: string) => {
  try {
    const stat = await api.statPath(path);
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
  } catch (error) {
    showError(error);
  }
};

export const openPathInWorkspace = (workspaceId: string, path: string) => {
  const workspace = findWorkspace(workspaceId);
  if (workspace) void openTypedPath(workspace, path);
};

const firstExistingFile = async (paths: string[]) => {
  let failure: unknown = null;
  for (const path of paths) {
    try {
      if ((await api.statPath(path))?.kind === "file") return path;
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure) throw failure;
  return null;
};

export const openPathFromTerminal = async (workspaceId: string, target: PathLinkTarget) => {
  const workspace = findWorkspace(workspaceId);
  if (!workspace) return;
  const recent = useSessionsStore.getState().byId[workspace.sessionId]?.recentCwds ?? [];
  try {
    const path = await firstExistingFile(candidatePaths(target.raw, [...recent, workspace.cwd]));
    if (path) openFileAt(workspaceId, path, target.line);
    else toast.error(`Can't find ${target.raw}`);
  } catch (error) {
    showError(error);
  }
};
