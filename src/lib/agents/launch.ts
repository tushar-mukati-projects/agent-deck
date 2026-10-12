import { CLAUDE, findAgent, type LaunchContext } from "@/lib/agents/registry";
import type { TerminalSpec } from "@/lib/terminal/registry";
import { newId } from "@/lib/utils";
import { parseWslPath, shellQuote } from "@/lib/wsl";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { SessionInfo, ShellTab, Workspace } from "@/types";

interface LaunchOptions extends LaunchContext {
  fork?: boolean;
}

export interface LaunchPlan {
  sessionId: string;
  args: string[];
  pending: boolean;
}

const WSL_LOGIN_SHELL =
  'shell=$(getent passwd "$(id -un)" | cut -d: -f7); exec "${shell:-${SHELL:-/bin/sh}}" -lic "$0"';

const windowsHome = () => useSessionsStore.getState().environment?.home ?? "C:\\";

export const isPersisted = (workspace: Pick<Workspace, "sessionId" | "filePath">) =>
  !!workspace.filePath || !!useSessionsStore.getState().byId[workspace.sessionId];

export const planLaunch = (workspace: Workspace, options: LaunchOptions = {}): LaunchPlan => {
  const agent = findAgent(workspace.agent);
  const extra = agent.extraArgs({ deckTheme: true });
  if (!isPersisted(workspace) || !agent.history) {
    return {
      sessionId: workspace.sessionId,
      args: [...agent.newArgs(workspace.sessionId, options), ...extra],
      pending: agent.history && !agent.assignsSessionIds,
    };
  }
  if (options.fork && agent.canFork) {
    const sessionId = newId();
    return {
      sessionId,
      args: [...agent.forkArgs(workspace.sessionId, sessionId), ...extra],
      pending: !agent.assignsSessionIds,
    };
  }
  return {
    sessionId: workspace.sessionId,
    args: [...agent.resumeArgs(workspace.sessionId), ...extra],
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

const powershellCommand = (cwd: string, command: string[]) =>
  `Set-Location -LiteralPath ${powershellQuote(cwd)}; & ${command.map(powershellQuote).join(" ")}; exit $LASTEXITCODE`;

const wslLaunch = (root: string, command: string[] | null) => {
  const location = parseWslPath(root);
  if (!location) return null;
  const base = ["-d", location.distro, "--cd", location.linuxPath];
  const args = command
    ? [...base, "-e", "sh", "-c", WSL_LOGIN_SHELL, `exec ${command.map(shellQuote).join(" ")}`]
    : base;
  return { cwd: windowsHome(), program: "wsl.exe", args };
};

const windowsLaunch = (workspace: Workspace, command: string[]) =>
  workspace.agent === CLAUDE
    ? { cwd: workspace.cwd, program: command[0], args: command.slice(1) }
    : {
        cwd: workspace.cwd,
        program: powershellProgram(),
        args: ["-NoLogo", "-Command", powershellCommand(workspace.cwd, command)],
      };

export const agentSpec = (workspace: Workspace & { agentTerminalId: string }): TerminalSpec => {
  const command = [...findAgent(workspace.agent).command, ...workspace.agentArgs];
  return {
    id: workspace.agentTerminalId,
    kind: "agent",
    agent: workspace.agent,
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
  ...(wslLaunch(shell.cwd, null) ?? { cwd: shell.cwd, program: shell.program, args: [] }),
});

const powershellArg = (arg: string) => (/^[\w./:\\-]+$/.test(arg) ? arg : powershellQuote(arg));

export const resumeCommandLine = (session: SessionInfo) => {
  const agent = findAgent(session.agent);
  const command = [...agent.command, ...agent.resumeArgs(session.id), ...agent.extraArgs()];
  const wsl = parseWslPath(session.cwd);
  return wsl
    ? `cd ${shellQuote(wsl.linuxPath)} && ${command.map(shellQuote).join(" ")}`
    : `Set-Location -LiteralPath ${powershellQuote(session.cwd)}; & ${command.map(powershellArg).join(" ")}`;
};
