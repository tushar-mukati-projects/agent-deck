import { samePath } from "@/lib/utils";
import { blankWorkspace } from "@/stores/workspace-factory";
import type { Workspace } from "@/types";

interface SavedWorkspaces {
  workspaces: Workspace[];
  activeId: string | null;
}

const withDefaults = (saved: Workspace): Workspace => {
  const workspace = { ...blankWorkspace(saved), ...saved };
  const { activeFile, openFiles } = workspace;
  return {
    ...workspace,
    activeFile:
      activeFile && openFiles.some((f) => samePath(f, activeFile))
        ? activeFile
        : (openFiles[0] ?? null),
  };
};

export const restoreSaved = (persisted: unknown): SavedWorkspaces => {
  const saved = (persisted ?? {}) as Partial<SavedWorkspaces>;
  const workspaces = (saved.workspaces ?? []).map(withDefaults);
  const activeId =
    workspaces.find((w) => w.id === saved.activeId)?.id ?? workspaces[0]?.id ?? null;
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
