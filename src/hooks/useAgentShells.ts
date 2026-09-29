import { useEffect, useMemo } from "react";

import { useSessionFile } from "@/hooks/useSessionFile";
import { useExternalLive } from "@/hooks/useWorkspaceStatus";
import { processStart, shownTasks } from "@/lib/agent-tasks";
import { CLAUDE } from "@/lib/agents/registry";
import { api } from "@/lib/tauri/commands";
import { useAgentTasksStore } from "@/stores/agent-tasks-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useTerminalStore } from "@/stores/terminal-store";
import type { Workspace } from "@/types";

export const useAgentStart = (workspace: Workspace) => {
  const running = useTerminalStore((s) => {
    const status = workspace.agentTerminalId
      ? s.terminals[workspace.agentTerminalId]?.status
      : null;
    return workspace.mode === "live" && (status === "running" || status === "starting");
  });
  const external = !!useExternalLive(workspace.sessionId);
  const started = useSessionsStore((s) => processStart(s.live, workspace.sessionId));
  return running || external ? started : null;
};

export const useAgentShells = (workspace: Workspace) => {
  const tasks = useAgentTasksStore((s) => s.bySession[workspace.sessionId]);
  const started = useAgentStart(workspace);
  return useMemo(() => shownTasks(tasks ?? [], started, Date.now()), [tasks, started]);
};

export const useAgentShellSync = (workspace: Workspace) => {
  const { filePath, distro } = useSessionFile(workspace);
  const modifiedMs = useSessionsStore((s) => s.byId[workspace.sessionId]?.modifiedMs ?? 0);
  const alive = useAgentStart(workspace) !== null;
  const { sessionId, agent } = workspace;

  useEffect(() => {
    if (!filePath || agent !== CLAUDE || !alive) return;
    let cancelled = false;
    api
      .sessionTasks(filePath, distro)
      .then((tasks) => !cancelled && useAgentTasksStore.getState().setTasks(sessionId, tasks))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [filePath, distro, modifiedMs, alive, sessionId, agent]);
};
