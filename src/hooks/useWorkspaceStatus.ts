import type { DotTone } from "@/components/ui/feedback";
import { useSessionsStore } from "@/stores/sessions-store";
import { useTerminalStore } from "@/stores/terminal-store";
import type { WorkspaceRecord } from "@/stores/workspace-store";
import type { TerminalState } from "@/types";

export const terminalTone = (terminal: TerminalState | undefined): DotTone | null => {
  if (!terminal) return null;
  if (terminal.status === "error") return "error";
  if (terminal.status === "exited") return "exited";
  if (terminal.busy) return "busy";
  if (terminal.attention) return "attention";
  return "running";
};

export const useTerminal = (id: string | null | undefined) =>
  useTerminalStore((s) => (id ? s.terminals[id] : undefined));

export const useExternalLive = (sessionId: string | null | undefined) =>
  useSessionsStore((s) => {
    if (!sessionId) return undefined;
    const ownPids = new Set(
      Object.values(useTerminalStore.getState().terminals)
        .map((t) => t.pid)
        .filter(Boolean),
    );
    return s.live.find((l) => l.sessionId === sessionId && !ownPids.has(l.pid));
  });

export const useWorkspaceTone = (workspace: WorkspaceRecord): DotTone | null => {
  const terminal = useTerminal(workspace.claudeTerminalId);
  const external = useExternalLive(workspace.sessionId);
  if (workspace.mode === "live") return terminalTone(terminal);
  return external ? "external" : null;
};
