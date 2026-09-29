import { basename } from "@/lib/utils";
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

export const workspaceFromSession = (session: SessionInfo) =>
  blankWorkspace({
    id: session.id,
    sessionId: session.id,
    cwd: session.cwd,
    title: session.title ?? basename(session.cwd),
    filePath: session.filePath,
    agent: session.agent,
  });
