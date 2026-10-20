import { useEffect, useMemo } from "react";

import { showError } from "@/components/ui/feedback";
import { useSessionFile } from "@/hooks/useSessionFile";
import { useOwnPids } from "@/hooks/useWorkspaceStatus";
import { agentShells, agentStartedMs, runningSubagents } from "@/lib/agent-tasks";
import { CLAUDE } from "@/lib/agents/registry";
import { api } from "@/lib/tauri/commands";
import { useAgentTasksStore } from "@/stores/agent-tasks-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { isAgentRunning, useTerminalStore } from "@/stores/terminal-store";
import type { Workspace } from "@/types";

export const useAgentStart = (workspace: Workspace) => {
  const running = useTerminalStore((s) => isAgentRunning(workspace, s.terminals));
  const live = useSessionsStore((s) => s.live);
  const pids = useOwnPids();
  const { sessionId } = workspace;
  return useMemo(
    () => agentStartedMs(live, pids, sessionId, running),
    [live, pids, sessionId, running],
  );
};

export const useAgentShells = (workspace: Workspace) => {
  const tasks = useAgentTasksStore((s) => s.bySession[workspace.sessionId]);
  const hidden = useSettingsStore((s) => s.hideMode);
  const started = useAgentStart(workspace);
  return useMemo(
    () => agentShells(tasks, started, hidden, Date.now()),
    [tasks, started, hidden],
  );
};

export const useSubagents = (workspace: Workspace) => {
  const agents = useAgentTasksStore((s) => s.agentsBySession[workspace.sessionId]);
  const hidden = useSettingsStore((s) => s.hideMode);
  const started = useAgentStart(workspace);
  return useMemo(
    () => (hidden ? [] : runningSubagents(agents ?? [], started)),
    [agents, started, hidden],
  );
};

export const useAgentShellSync = (workspace: Workspace) => {
  const { filePath, distro } = useSessionFile(workspace);
  const modifiedMs = useSessionsStore((s) => s.byId[workspace.sessionId]?.modifiedMs ?? 0);
  const alive = useAgentStart(workspace) !== null;
  const { sessionId, agent } = workspace;

  useEffect(() => {
    if (!filePath || agent !== CLAUDE || !alive) return;
    let cancelled = false;
    api.sessionTasks(filePath, distro).then(
      (tasks) => {
        if (!cancelled) useAgentTasksStore.getState().setTasks(sessionId, tasks);
      },
      (error: unknown) => {
        if (!cancelled) showError(error);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [filePath, distro, modifiedMs, alive, sessionId, agent]);
};
