import { Bot, ChevronDown, Eraser, Plus, RotateCw, SquareTerminal, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusDot, type DotTone } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Alert } from "@/components/ui/panel";
import { panelTabClass, Tab, TabStrip } from "@/components/ui/tabs";
import { TerminalView } from "@/features/terminal/TerminalView";
import { AgentShellView } from "@/features/workspace/AgentShellView";
import { useAgentShells, useAgentStart } from "@/hooks/useAgentShells";
import { terminalTone, useTerminal } from "@/hooks/useWorkspaceStatus";
import { taskLabel, taskState, type TaskState } from "@/lib/agent-tasks";
import { agentName } from "@/lib/agents/registry";
import { shortcutLabel } from "@/lib/shortcuts";
import { clearTerminal } from "@/lib/terminal/registry";
import { basename, cn } from "@/lib/utils";
import { parseWslPath, shellQuote } from "@/lib/wsl";
import { useAgentTasksStore } from "@/stores/agent-tasks-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AgentTask, ShellTab, Workspace } from "@/types";

const TASK_TONE: Record<TaskState, DotTone> = {
  running: "running",
  completed: "exited",
  failed: "error",
  killed: "exited",
  stopped: "exited",
  ended: "exited",
};

const shellName = (shell: ShellTab, index: number) =>
  `${basename(shell.program).replace(/\.exe$/i, "")} ${index + 1}`;

const shellPath = (path: string) => {
  const wsl = parseWslPath(path);
  return wsl ? `${shellQuote(wsl.linuxPath)} ` : `"${path}" `;
};

const killShellWithConfirm = async (workspaceId: string, shell: ShellTab, name: string) => {
  if (useTerminalStore.getState().terminals[shell.id]?.busy) {
    const confirmed = await useUiStore.getState().askConfirm({
      title: `Kill ${name}?`,
      description: "Something is still running in this shell. Killing it stops that process.",
      confirmLabel: "Kill shell",
      destructive: true,
    });
    if (!confirmed) return;
  }
  useWorkspaceStore.getState().closeShell(workspaceId, shell.id);
};

const selectShell = (workspaceId: string, shellId: string) => {
  useAgentTasksStore.getState().select(workspaceId, null);
  useWorkspaceStore.getState().setActiveShell(workspaceId, shellId);
};

const ShellTabButton = ({
  workspace,
  shell,
  index,
  active,
}: {
  workspace: Workspace;
  shell: ShellTab;
  index: number;
  active: boolean;
}) => {
  const tone = terminalTone(useTerminal(shell.id));
  const name = shellName(shell, index);
  return (
    <Tab
      selected={active}
      onSelect={() => selectShell(workspace.id, shell.id)}
      onClose={() => void killShellWithConfirm(workspace.id, shell, name)}
      closeLabel={`Kill ${name}`}
      title={shell.cwd}
      className={panelTabClass(active)}
    >
      {tone && <StatusDot tone={tone === "attention" ? "running" : tone} className="size-1.5" />}
      <span className="max-w-[160px] truncate">{name}</span>
      {basename(shell.cwd) !== basename(workspace.cwd) && (
        <span className="text-faint">· {basename(shell.cwd)}</span>
      )}
    </Tab>
  );
};

const AgentShellTab = ({
  workspace,
  task,
  state,
  active,
  onClose,
}: {
  workspace: Workspace;
  task: AgentTask;
  state: TaskState;
  active: boolean;
  onClose?: () => void;
}) => (
  <Tab
    selected={active}
    onSelect={() => useAgentTasksStore.getState().select(workspace.id, task.id)}
    onClose={onClose}
    closeLabel="Close finished shell"
    title={`Started by ${agentName(workspace.agent)}: ${task.command}`}
    className={cn(panelTabClass(active), !onClose && "pr-2")}
  >
    <StatusDot tone={TASK_TONE[state]} className="size-1.5" />
    <Bot className="size-3 shrink-0 text-info" />
    <span className="max-w-[200px] truncate">{taskLabel(task)}</span>
    <span className="shrink-0 rounded border border-info/35 bg-info/10 px-1 text-[9px] leading-[13px] font-semibold tracking-wide text-info uppercase">
      agent
    </span>
  </Tab>
);

export const ShellPanel = ({ workspace }: { workspace: Workspace }) => {
  const { openShell, setShellPanel, restartShell } = useWorkspaceStore.getState();
  const agentShells = useAgentShells(workspace);
  const agentStarted = useAgentStart(workspace);
  const selectedTaskId = useAgentTasksStore((s) => s.selected[workspace.id] ?? null);
  const selectedTask = agentShells.find((t) => t.id === selectedTaskId) ?? null;
  const showTask = selectedTask ?? (workspace.shells.length === 0 ? agentShells[0] : null) ?? null;
  const activeShell = showTask
    ? undefined
    : (workspace.shells.find((s) => s.id === workspace.activeShellId) ?? workspace.shells[0]);
  const active = useTerminal(activeShell?.id);
  const closeTask = (task: AgentTask) =>
    taskState(task, agentStarted) === "running"
      ? undefined
      : () => useAgentTasksStore.getState().dismiss(workspace.sessionId, task.id);

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-1 px-2 py-1">
        <SquareTerminal className="mr-1 size-3.5 shrink-0 text-faint" />
        <TabStrip label="Shells" className="h-full min-w-0 flex-1 items-center gap-0.5">
          {workspace.shells.map((shell, index) => (
            <ShellTabButton
              key={shell.id}
              workspace={workspace}
              shell={shell}
              index={index}
              active={shell.id === activeShell?.id}
            />
          ))}
          {agentShells.length > 0 && workspace.shells.length > 0 && (
            <span className="mx-1 h-4 w-px shrink-0 bg-border" />
          )}
          {agentShells.map((task) => (
            <AgentShellTab
              key={task.id}
              workspace={workspace}
              task={task}
              state={taskState(task, agentStarted)}
              active={task.id === showTask?.id}
              onClose={closeTask(task)}
            />
          ))}
        </TabStrip>
        <IconButton
          label="New shell"
          shortcut={shortcutLabel("newShell")}
          onClick={() => openShell(workspace.id)}
        >
          <Plus />
        </IconButton>
        {activeShell && (
          <>
            <IconButton label="Clear output" onClick={() => clearTerminal(activeShell.id)}>
              <Eraser />
            </IconButton>
            <IconButton
              label="Kill shell"
              className="hover:bg-danger/15 hover:text-danger"
              onClick={() =>
                void killShellWithConfirm(
                  workspace.id,
                  activeShell,
                  shellName(activeShell, workspace.shells.indexOf(activeShell)),
                )
              }
            >
              <Trash2 />
            </IconButton>
          </>
        )}
        <IconButton
          label="Hide panel"
          shortcut={shortcutLabel("toggleShell")}
          onClick={() => setShellPanel(workspace.id, false)}
        >
          <ChevronDown />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        {showTask && (
          <AgentShellView
            key={showTask.id}
            workspaceId={workspace.id}
            task={showTask}
            state={taskState(showTask, agentStarted)}
            onClose={closeTask(showTask)}
          />
        )}
        {activeShell && (
          <TerminalView key={activeShell.id} terminalId={activeShell.id} dropText={shellPath} />
        )}
        {active?.status === "exited" && activeShell && (
          <div className="absolute right-3 bottom-3 flex items-center gap-2 rounded-lg border border-border-strong bg-panel/95 px-3 py-1.5 text-xs text-muted shadow-xl shadow-shadow">
            Process exited{active.exitCode ? ` (${active.exitCode})` : ""}
            <Button size="xs" onClick={() => restartShell(workspace.id, activeShell.id)}>
              <RotateCw /> Restart
            </Button>
          </div>
        )}
        {active?.status === "error" && activeShell && (
          <Alert tone="danger" className="absolute inset-x-3 top-3 font-mono">
            {active.error}
          </Alert>
        )}
      </div>
    </div>
  );
};
