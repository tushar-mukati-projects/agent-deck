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

export const restoredWorkspace = (
  workspace: Workspace,
  isRunning: (terminalId: string) => boolean,
): Workspace => {
  const shells = workspace.shells.filter((shell) => isRunning(shell.id));
  const agentAlive = !!workspace.agentTerminalId && isRunning(workspace.agentTerminalId);
  return {
    ...workspace,
    mode: agentAlive ? "live" : "preview",
    agentTerminalId: agentAlive ? workspace.agentTerminalId : null,
    pendingSince: agentAlive || !workspace.filePath ? workspace.pendingSince : null,
    shells,
    activeShellId: shells.some((shell) => shell.id === workspace.activeShellId)
      ? workspace.activeShellId
      : (shells[0]?.id ?? null),
    shellPanelOpen: workspace.shellPanelOpen && shells.length > 0,
  };
};
