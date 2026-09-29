import { CLAUDE, findAgent, type LaunchContext } from "@/lib/agents/registry";
import type { TerminalSpec } from "@/lib/terminal/registry";
import { newId } from "@/lib/utils";
import { parseWslPath, shellQuote } from "@/lib/wsl";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { ShellTab, Workspace } from "@/types";

export interface LaunchOptions extends LaunchContext {
  fork?: boolean;
}

export interface LaunchPlan {
  sessionId: string;
  args: string[];
  pending: boolean;
}

const windowsHome = () => useSessionsStore.getState().environment?.home ?? "C:\\";

export const isPersisted = (workspace: Pick<Workspace, "sessionId" | "filePath">) =>
  !!workspace.filePath || !!useSessionsStore.getState().byId[workspace.sessionId];

export const planLaunch = (workspace: Workspace, options: LaunchOptions = {}): LaunchPlan => {
  const agent = findAgent(workspace.agent);
  if (!isPersisted(workspace) || !agent.history) {
    return {
      sessionId: workspace.sessionId,
      args: agent.newArgs(workspace.sessionId, options),
      pending: agent.history && !agent.assignsSessionIds,
    };
  }
  if (options.fork && agent.canFork) {
    const sessionId = newId();
    return {
      sessionId,
      args: agent.forkArgs(workspace.sessionId, sessionId),
      pending: !agent.assignsSessionIds,
    };
  }
  return {
    sessionId: workspace.sessionId,
    args: agent.resumeArgs(workspace.sessionId),
    pending: false,
  };
};

export const defaultShellProgram = () =>
  useSettingsStore.getState().shellProgram.trim() ||
  useSessionsStore.getState().environment?.shell ||
  "powershell.exe";

const powershellProgram = () => {
  const shell = defaultShellProgram();
  return /pwsh|powershell/i.test(shell) ? shell : "powershell.exe";
};

const powershellQuote = (arg: string) => `'${arg.replace(/'/g, "''")}'`;

const wslLaunch = (root: string, command: string[] | null) => {
  const location = parseWslPath(root);
  if (!location) return null;
  const base = ["-d", location.distro, "--cd", location.linuxPath];
  if (!command) return { cwd: windowsHome(), program: "wsl.exe", args: base };
  const loginShell = useSessionsStore.getState().wslShells[location.distro] ?? "/bin/bash";
  return {
    cwd: windowsHome(),
    program: "wsl.exe",
    args: [...base, "-e", loginShell, "-lic", `exec ${command.map(shellQuote).join(" ")}`],
  };
};

const windowsLaunch = (workspace: Workspace, command: string[]) => {
  if (workspace.agent === CLAUDE || !workspace.agent) {
    return { cwd: workspace.cwd, program: command[0], args: command.slice(1) };
  }
  return {
    cwd: workspace.cwd,
    program: powershellProgram(),
    args: ["-NoLogo", "-Command", `& ${command.map(powershellQuote).join(" ")}`],
  };
};

export const agentSpec = (workspace: Workspace & { agentTerminalId: string }): TerminalSpec => {
  const command = [...findAgent(workspace.agent).command, ...workspace.agentArgs];
  return {
    id: workspace.agentTerminalId,
    kind: "agent",
    workspaceId: workspace.id,
    root: workspace.cwd,
    ...(wslLaunch(workspace.cwd, command) ?? windowsLaunch(workspace, command)),
  };
};

export const shellSpec = (workspaceId: string, shell: ShellTab): TerminalSpec => ({
  id: shell.id,
  kind: "shell",
  workspaceId,
  root: shell.cwd,
  initialInput: shell.command,
  ...(wslLaunch(shell.cwd, null) ?? { cwd: shell.cwd, program: shell.program, args: [] }),
});
