import { useSessionsStore } from "@/stores/sessions-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { SessionInfo } from "@/types";

const openElsewhere = (sessionId: string) => {
  const ownPids = new Set(Object.values(useTerminalStore.getState().terminals).map((t) => t.pid));
  const inDeck = useWorkspaceStore.getState().workspaces.some((w) => w.sessionId === sessionId && w.mode === "live");
  if (inDeck) return null;
  return useSessionsStore.getState().live.find((l) => l.sessionId === sessionId && !ownPids.has(l.pid)) ?? null;
};

const confirmResume = async (sessionId: string) => {
  const live = openElsewhere(sessionId);
  if (!live) return true;
  return useUiStore.getState().askConfirm({
    title: "This session is already open elsewhere",
    description: `It's running in another terminal${live.distro ? ` in WSL ${live.distro}` : ""} (PID ${live.pid}). Resuming here too means two copies writing to the same conversation. Fork it instead to branch off safely.`,
    confirmLabel: "Resume anyway",
    destructive: true,
  });
};

export const resumeSession = async (session: SessionInfo) => {
  if (!(await confirmResume(session.id))) {
    useWorkspaceStore.getState().openSession(session);
    return;
  }
  useWorkspaceStore.getState().openSession(session, { resume: true });
};

export const resumeWorkspace = async (workspaceId: string) => {
  const workspace = useWorkspaceStore.getState().workspaces.find((w) => w.id === workspaceId);
  if (!workspace || !(await confirmResume(workspace.sessionId))) return;
  useWorkspaceStore.getState().resume(workspaceId);
};
