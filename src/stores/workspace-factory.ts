import { basename } from "@/lib/utils";
import type { SessionInfo, Workspace } from "@/types";

type WorkspaceSeed = Pick<Workspace, "id" | "sessionId" | "cwd" | "title" | "filePath">;

export const blankWorkspace = (seed: WorkspaceSeed): Workspace => ({
  ...seed,
  mode: "preview",
  claudeTerminalId: null,
  claudeArgs: [],
  shells: [],
  activeShellId: null,
  shellPanelOpen: false,
  openFiles: [],
  activeFile: null,
});

export const workspaceFromSession = (session: SessionInfo) =>
  blankWorkspace({
    id: session.id,
    sessionId: session.id,
    cwd: session.cwd,
    title: session.title ?? basename(session.cwd),
    filePath: session.filePath,
  });
