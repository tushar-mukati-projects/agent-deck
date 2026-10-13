import { samePath } from "@/lib/utils";
import { blankWorkspace } from "@/stores/workspace-factory";
import type { Workspace } from "@/types";

interface SavedWorkspaces {
  workspaces: Workspace[];
  activeId: string | null;
}

const withDefaults = (saved: Workspace): Workspace => {
  const workspace = { ...blankWorkspace(saved), ...saved };
  const activeFile =
    workspace.activeFile && workspace.openFiles.some((f) => samePath(f, workspace.activeFile!))
      ? workspace.activeFile
      : (workspace.openFiles[0] ?? null);
  return { ...workspace, activeFile };
};

export const restoreSaved = (persisted: unknown): SavedWorkspaces => {
  const saved = (persisted ?? {}) as Partial<SavedWorkspaces>;
  const workspaces = (saved.workspaces ?? []).map(withDefaults);
  const activeId = workspaces.some((w) => w.id === saved.activeId)
    ? saved.activeId!
    : (workspaces[0]?.id ?? null);
  return { workspaces, activeId };
};
