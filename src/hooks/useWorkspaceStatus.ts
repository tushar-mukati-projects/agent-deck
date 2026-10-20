import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { DotTone } from "@/components/ui/feedback";
import { openElsewhere } from "@/lib/sessions";
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

export const useOwnPids = () =>
  useTerminalStore(useShallow((s) => Object.values(s.terminals).map((t) => t.pid)));

export const useExternalLive = (sessionId: string | null | undefined) => {
  const live = useSessionsStore((s) => s.live);
  const pids = useOwnPids();
  return useMemo(
    () => (sessionId ? openElsewhere(live, pids, sessionId) : null),
    [live, pids, sessionId],
  );
};

export const useWorkspaceTone = (workspace: Workspace): DotTone | null => {
  const tone = useTerminalStore((s) =>
    workspace.agentTerminalId ? terminalTone(s.terminals[workspace.agentTerminalId]) : null,
  );
  const external = useSessionsStore((s) => s.live.some((l) => l.sessionId === workspace.sessionId));
  if (workspace.mode === "live") return tone;
  return external ? "external" : null;
};
