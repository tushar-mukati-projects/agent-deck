import { adoptSessions } from "@/lib/adopt";
import { movedPath } from "@/lib/entries";
import { basename, isWithin, neighborAt, samePath } from "@/lib/utils";
import type { SessionInfo, Workspace } from "@/types";

type WorkspaceSeed = Pick<Workspace, "id" | "sessionId" | "cwd" | "title" | "filePath"> &
  Partial<Pick<Workspace, "agent">>;

export const blankWorkspace = (seed: WorkspaceSeed): Workspace => ({
  ...seed,
  agent: seed.agent ?? "claude",
  pendingSince: null,
  mode: "preview",
  agentTerminalId: null,
  agentArgs: [],
  shells: [],
  activeShellId: null,
  shellPanelOpen: false,
  openFiles: [],
  activeFile: null,
});

export const workspaceTerminalIds = (workspace: Workspace) =>
  [workspace.agentTerminalId, ...workspace.shells.map((s) => s.id)].filter(
    (id): id is string => !!id,
  );

export const workspaceFromSession = (session: SessionInfo) =>
  blankWorkspace({
    id: session.id,
    sessionId: session.id,
    cwd: session.cwd,
    title: session.title ?? basename(session.cwd),
    filePath: session.filePath,
    agent: session.agent,
  });

export const syncedWorkspaces = (workspaces: Workspace[], byId: Record<string, SessionInfo>) => {
  const adopted = adoptSessions(workspaces, byId);
  let changed = adopted !== workspaces;
  const synced = adopted.map((w) => {
    const session = byId[w.sessionId];
    if (!session) return w;
    const title = session.title ?? w.title;
    if (title === w.title && session.filePath === w.filePath) return w;
    changed = true;
    return { ...w, title, filePath: session.filePath };
  });
  return changed ? synced : workspaces;
};

export const cycledWorkspace = (
  workspaces: Workspace[],
  activeId: string | null,
  direction: 1 | -1,
) => {
  const index = workspaces.findIndex((w) => w.id === activeId);
  const next =
    index < 0
      ? direction > 0
        ? 0
        : workspaces.length - 1
      : (index + direction + workspaces.length) % workspaces.length;
  return workspaces.at(next) ?? null;
};

export const movedWorkspace = (workspaces: Workspace[], fromId: string, toId: string) => {
  const from = workspaces.findIndex((w) => w.id === fromId);
  const to = workspaces.findIndex((w) => w.id === toId);
  if (from < 0 || to < 0 || from === to) return workspaces;
  const list = [...workspaces];
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return list;
};

export const closeShellFields = (workspace: Workspace, shellId: string) => {
  const index = workspace.shells.findIndex((s) => s.id === shellId);
  const shells = workspace.shells.filter((s) => s.id !== shellId);
  return {
    shells,
    activeShellId:
      workspace.activeShellId === shellId
        ? (neighborAt(shells, index)?.id ?? null)
        : workspace.activeShellId,
    shellPanelOpen: shells.length > 0 && workspace.shellPanelOpen,
  };
};

export const openFileFields = (workspace: Workspace, path: string) => ({
  openFiles: workspace.openFiles.some((f) => samePath(f, path))
    ? workspace.openFiles
    : [...workspace.openFiles, path],
  activeFile: path,
});

export const withMovedFiles = (workspace: Workspace, from: string, to: string) =>
  workspace.openFiles.some((f) => isWithin(f, from))
    ? {
        ...workspace,
        openFiles: workspace.openFiles.map((f) => movedPath(f, from, to)),
        activeFile: workspace.activeFile && movedPath(workspace.activeFile, from, to),
      }
    : workspace;

export const closeFileFields = (workspace: Workspace, path: string) => {
  const index = workspace.openFiles.findIndex((f) => samePath(f, path));
  const openFiles = workspace.openFiles.filter((f) => !samePath(f, path));
  const wasActive = !!workspace.activeFile && samePath(workspace.activeFile, path);
  return {
    openFiles,
    activeFile: wasActive ? (neighborAt(openFiles, index) ?? null) : workspace.activeFile,
  };
};
