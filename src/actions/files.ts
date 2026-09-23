import { toast } from "sonner";

import type { PathLinkTarget } from "@/lib/terminal/links";
import { pasteIntoTerminal } from "@/lib/terminal/registry";
import { api } from "@/lib/tauri/commands";
import { basename, normalizePath, relativePath } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { useViewerStore } from "@/stores/viewer-store";
import { findWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

export const mentionText = (path: string, root: string) => {
  const rel = relativePath(path, root).replace(/\\/g, "/");
  return /\s/.test(rel) ? `@"${rel}" ` : `@${rel} `;
};

export const canMention = (workspace: Workspace) =>
  workspace.mode === "live" && !!workspace.claudeTerminalId;

export const mentionInClaude = (workspace: Workspace, path: string) => {
  if (!workspace.claudeTerminalId || workspace.mode !== "live") {
    toast("Resume the session first to mention files in Claude");
    return;
  }
  pasteIntoTerminal(workspace.claudeTerminalId, mentionText(path, workspace.cwd));
};

export const closeFilesWithConfirm = async (workspaceId: string, tabs: string[]) => {
  const { drafts, setDraft, setEditing } = useViewerStore.getState();
  const dirty = tabs.filter((tab) => normalizePath(tab) in drafts);
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
  for (const tab of tabs) {
    setDraft(tab, null);
    setEditing(tab, false);
    closeFile(workspaceId, tab);
  }
};

export const closeFileWithConfirm = (workspaceId: string, tab: string) =>
  closeFilesWithConfirm(workspaceId, [tab]);

export const openPathFromTerminal = async (workspaceId: string, target: PathLinkTarget) => {
  if (!findWorkspace(workspaceId)) return;
  const content = await api.readFile(target.path).catch(() => null);
  if (!content) {
    toast.error(`Can't open ${basename(target.path)}`);
    return;
  }
  useWorkspaceStore.getState().openFile(workspaceId, target.path);
};
