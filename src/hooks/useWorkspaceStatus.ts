import { useMemo } from "react";

import type { DotTone } from "@/components/ui/feedback";
import { externalLive } from "@/lib/sessions";
import { useSessionsStore } from "@/stores/sessions-store";
import { useTerminalStore } from "@/stores/terminal-store";
import type { TerminalState, Workspace } from "@/types";

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

export const useExternalLive = (sessionId: string | null | undefined) => {
  const live = useSessionsStore((s) => s.live);
  const terminals = useTerminalStore((s) => s.terminals);
  return useMemo(
    () =>
      sessionId ? externalLive(live, terminals).find((l) => l.sessionId === sessionId) : undefined,
    [live, terminals, sessionId],
  );
};

export const useWorkspaceTone = (workspace: Workspace): DotTone | null => {
  const terminal = useTerminal(workspace.claudeTerminalId);
  const external = useSessionsStore((s) => s.live.some((l) => l.sessionId === workspace.sessionId));
  if (workspace.mode === "live") return terminalTone(terminal);
  return external ? "external" : null;
};
