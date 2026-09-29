import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { DotTone } from "@/components/ui/feedback";
import { terminalTone, useOwnPids } from "@/hooks/useWorkspaceStatus";
import { externalLive } from "@/lib/sessions";
import { useSessionsStore } from "@/stores/sessions-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

export const useSessionTones = () => {
  const agentTerminals = useWorkspaceStore(
    useShallow((s) =>
      Object.fromEntries(
        s.workspaces.flatMap((w) => (w.agentTerminalId ? [[w.sessionId, w.agentTerminalId]] : [])),
      ),
    ),
  );
  const terminalTones = useTerminalStore(
    useShallow((s) =>
      Object.fromEntries(Object.values(s.terminals).map((t) => [t.id, terminalTone(t)])),
    ),
  );
  const live = useSessionsStore((s) => s.live);
  const pids = useOwnPids();

  return useMemo(() => {
    const tones = new Map<string, DotTone>();
    for (const entry of externalLive(live, pids)) tones.set(entry.sessionId, "external");
    for (const [sessionId, terminalId] of Object.entries(agentTerminals)) {
      const tone = terminalTones[terminalId];
      if (tone) tones.set(sessionId, tone);
    }
    return tones;
  }, [agentTerminals, terminalTones, live, pids]);
};
