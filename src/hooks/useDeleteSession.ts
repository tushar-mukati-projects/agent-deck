import { toast } from "sonner";

import { api } from "@/lib/tauri/commands";
import { errorMessage } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { SessionInfo } from "@/types";

const promptLabel = (session: SessionInfo) =>
  `${session.promptCount} ${session.promptCount === 1 ? "prompt" : "prompts"}`;

const runningInDeck = (sessionId: string) => {
  const terminals = useTerminalStore.getState().terminals;
  return useWorkspaceStore
    .getState()
    .workspaces.some(
      (w) =>
        w.sessionId === sessionId &&
        !!w.claudeTerminalId &&
        ["running", "starting"].includes(terminals[w.claudeTerminalId]?.status ?? ""),
    );
};

export const deleteSessionWithConfirm = async (session: SessionInfo) => {
  if (runningInDeck(session.id)) {
    toast.error("This session is running here. Close its tab first.");
    return;
  }
  if (useSessionsStore.getState().live.some((l) => l.sessionId === session.id)) {
    toast.error("This session is open in another terminal. Close it there first.");
    return;
  }
  const confirmed = await useUiStore.getState().askConfirm({
    title: `Delete “${session.title ?? "Untitled session"}”?`,
    description: session.distro
      ? `This permanently deletes the conversation (${promptLabel(session)}) from WSL ${session.distro}. It can't be undone.`
      : `The conversation (${promptLabel(session)}) and its history files will be moved to the Recycle Bin.`,
    confirmLabel: session.distro ? "Delete permanently" : "Move to Recycle Bin",
    destructive: true,
  });
  if (!confirmed) return;

  try {
    await api.deleteSession(session.filePath, session.distro);
    const { workspaces, close } = useWorkspaceStore.getState();
    await Promise.all(workspaces.filter((w) => w.sessionId === session.id).map((w) => close(w.id)));
    useSessionsStore.getState().removeSession(session.id);
    toast.success(session.distro ? "Session deleted" : "Session moved to the Recycle Bin");
  } catch (error) {
    toast.error(errorMessage(error));
  }
};
