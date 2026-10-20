import { toast } from "sonner";

import { showError } from "@/components/ui/feedback";
import { api } from "@/lib/tauri/commands";
import { basename, dirname, isWithin } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";
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

export const askRename = (workspace: Workspace, entry: DirEntry) =>
  useUiStore.getState().setEntryRequest({
    kind: "rename",
    workspaceId: workspace.id,
    path: entry.path,
    isDir: entry.isDir,
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

const unsavedWithin = (path: string) =>
  useWorkspaceStore
    .getState()
    .workspaces.flatMap((w) => w.openFiles)
    .find((file) => isWithin(file, path) && isDirty(file));

export const renameEntry = async (request: RenameRequest, name: string) => {
  if (name === basename(request.path)) return true;
  const unsaved = unsavedWithin(request.path);
  if (unsaved) {
    toast.error(`Save or discard your changes to ${basename(unsaved)} first.`);
    return false;
  }
  try {
    const path = await api.renameEntry(request.path, name);
    useWorkspaceStore.getState().movePaths(request.path, path);
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
  return [
    parseWslPath(entry.path)
      ? "This permanently deletes it from WSL. It can't be undone."
      : "It goes to the Recycle Bin, so you can restore it.",
    unsaved ? `Unsaved changes to ${basename(unsaved)} will be lost.` : "",
  ]
    .join(" ")
    .trim();
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
    const { workspaces, closeFile } = useWorkspaceStore.getState();
    const removed = workspaces.flatMap((w) =>
      w.openFiles.filter((file) => isWithin(file, entry.path)).map((file) => ({ id: w.id, file })),
    );
    for (const { id, file } of removed) closeFile(id, file);
    useViewerStore.getState().forget(removed.map(({ file }) => file));
    const explorer = useExplorerStore.getState();
    if (entry.isDir) explorer.forget(entry.path);
    await explorer.load(dirname(entry.path));
  } catch (error) {
    showError(error);
  }
};
