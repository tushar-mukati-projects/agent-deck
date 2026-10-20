import { toast } from "sonner";

import { showError } from "@/components/ui/feedback";
import { whereItGoes } from "@/lib/agent-config/removals";
import { tabTargetPath } from "@/lib/diff-tabs";
import { api } from "@/lib/tauri/commands";
import { basename, dirname, isWithin } from "@/lib/utils";
import { useExplorerStore } from "@/stores/explorer-store";
import { useUiStore, type EntryRequest } from "@/stores/ui-store";
import { isDirty, useViewerStore } from "@/stores/viewer-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { DirEntry, Workspace } from "@/types";

type CreateRequest = Extract<EntryRequest, { kind: "create" }>;
type RenameRequest = Extract<EntryRequest, { kind: "rename" }>;

export const askNewEntry = (workspace: Workspace, dir: string, isDir: boolean) =>
  useUiStore.getState().setEntryRequest({
    kind: "create",
    workspaceId: workspace.id,
    root: workspace.cwd,
    dir,
    isDir,
  });

export const createEntry = async (request: CreateRequest, name: string) => {
  try {
    const path = await api.createEntry(request.dir, name, request.isDir);
    const explorer = useExplorerStore.getState();
    await explorer.load(request.dir);
    await explorer.reveal(path, request.root);
    if (!request.isDir) useWorkspaceStore.getState().openFile(request.workspaceId, path);
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
};

const openTabsWithin = (path: string) =>
  useWorkspaceStore.getState().workspaces.flatMap((w) =>
    w.openFiles
      .filter((tab) => isWithin(tabTargetPath(tab), path))
      .map((tab) => ({ id: w.id, tab })),
  );

const unsavedWithin = (path: string) =>
  openTabsWithin(path).find(({ tab }) => isDirty(tab))?.tab ?? null;

export const renameEntry = async (request: RenameRequest, name: string) => {
  if (name === basename(request.path)) return true;
  const unsaved = unsavedWithin(request.path);
  if (unsaved) {
    toast.error(`Save or discard your changes to ${basename(unsaved)} first.`);
    return false;
  }
  try {
    const moved = openTabsWithin(request.path).map(({ tab }) => tabTargetPath(tab));
    const path = await api.renameEntry(request.path, name);
    useWorkspaceStore.getState().movePaths(request.path, path);
    useViewerStore.getState().forget(moved);
    const explorer = useExplorerStore.getState();
    if (request.isDir) explorer.forget(request.path);
    await explorer.load(dirname(request.path));
    explorer.select(path);
    return true;
  } catch (error) {
    showError(error);
    return false;
  }
};

const deleteNotice = (entry: DirEntry) => {
  const unsaved = unsavedWithin(entry.path);
  return unsaved
    ? `${whereItGoes(entry.path)} Unsaved changes to ${basename(unsaved)} will be lost.`
    : whereItGoes(entry.path);
};

export const deleteEntry = async (entry: DirEntry) => {
  const confirmed = await useUiStore.getState().askConfirm({
    title: `Delete "${entry.name}"?`,
    description: deleteNotice(entry),
    confirmLabel: "Delete",
    destructive: true,
  });
  if (!confirmed) return;
  try {
    await api.deleteEntry(entry.path);
    const removed = openTabsWithin(entry.path);
    const { closeFile } = useWorkspaceStore.getState();
    for (const { id, tab } of removed) closeFile(id, tab);
    useViewerStore.getState().forget(removed.map(({ tab }) => tabTargetPath(tab)));
    const explorer = useExplorerStore.getState();
    if (entry.isDir) explorer.forget(entry.path);
    await explorer.load(dirname(entry.path));
  } catch (error) {
    showError(error);
  }
};
