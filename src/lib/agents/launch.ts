import {
  CLAUDE,
  findAgent,
  type AgentSettings,
  type LaunchContext,
} from "@/lib/agents/registry";
import type { TerminalSpec } from "@/lib/terminal/registry";
import { newId } from "@/lib/utils";
import { parseWslPath, shellQuote } from "@/lib/wsl";
import type { SettingsData } from "@/stores/settings-store";
import type { AppEnvironment, SessionInfo, ShellTab, Workspace } from "@/types";

export type LaunchEnvironment = {
  settings: AgentSettings & Pick<SettingsData, "shellProgram">;
  environment: AppEnvironment | null;
  sessions: Record<string, SessionInfo>;
};

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

const windowsHome = ({ environment }: LaunchEnvironment) => environment?.home ?? "C:\\";

export const isPersisted = (
  workspace: Pick<Workspace, "sessionId" | "filePath">,
  sessions: Record<string, SessionInfo>,
) => !!workspace.filePath || !!sessions[workspace.sessionId];

export const planLaunch = (
  workspace: Workspace,
  launch: LaunchEnvironment,
  options: LaunchOptions = {},
): LaunchPlan => {
  const agent = findAgent(workspace.agent, launch.settings);
  const extra = agent.extraArgs({ deckTheme: true });
  if (!isPersisted(workspace, launch.sessions) || !agent.history) {
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

export const defaultShellProgram = ({ settings, environment }: LaunchEnvironment) =>
  settings.shellProgram.trim() || environment?.shell || "powershell.exe";

const powershellProgram = (launch: LaunchEnvironment) => {
  const shell = defaultShellProgram(launch);
  return /pwsh|powershell/i.test(shell) ? shell : "powershell.exe";
};

const powershellQuote = (arg: string) => `'${arg.replace(/'/g, "''")}'`;

const powershellCommand = (cwd: string, command: string[]) =>
  `Set-Location -LiteralPath ${powershellQuote(cwd)}; & ${command.map(powershellQuote).join(" ")}; exit $LASTEXITCODE`;

const wslLaunch = (root: string, command: string[] | null, launch: LaunchEnvironment) => {
  const location = parseWslPath(root);
  if (!location) return null;
  const base = ["-d", location.distro, "--cd", location.linuxPath];
  const args = command
    ? [...base, "-e", "sh", "-c", WSL_LOGIN_SHELL, `exec ${command.map(shellQuote).join(" ")}`]
    : base;
  return { cwd: windowsHome(launch), program: "wsl.exe", args };
};

const windowsLaunch = (workspace: Workspace, command: string[], launch: LaunchEnvironment) =>
  workspace.agent === CLAUDE
    ? { cwd: workspace.cwd, program: command[0], args: command.slice(1) }
    : {
        cwd: workspace.cwd,
        program: powershellProgram(launch),
        args: ["-NoLogo", "-Command", powershellCommand(workspace.cwd, command)],
      };

export const agentSpec = (
  workspace: Workspace & { agentTerminalId: string },
  launch: LaunchEnvironment,
): TerminalSpec => {
  const command = [...findAgent(workspace.agent, launch.settings).command, ...workspace.agentArgs];
  return {
    id: workspace.agentTerminalId,
    kind: "agent",
    agent: workspace.agent,
    workspaceId: workspace.id,
    root: workspace.cwd,
    ...(wslLaunch(workspace.cwd, command, launch) ?? windowsLaunch(workspace, command, launch)),
  };
};

export const shellSpec = (
  workspaceId: string,
  shell: ShellTab,
  launch: LaunchEnvironment,
): TerminalSpec => ({
  id: shell.id,
  kind: "shell",
  workspaceId,
  root: shell.cwd,
  ...(wslLaunch(shell.cwd, null, launch) ?? { cwd: shell.cwd, program: shell.program, args: [] }),
});

const powershellArg = (arg: string) => (/^[\w./:\\-]+$/.test(arg) ? arg : powershellQuote(arg));

export const resumeCommandLine = (session: SessionInfo, settings: AgentSettings) => {
  const agent = findAgent(session.agent, settings);
  const command = [...agent.command, ...agent.resumeArgs(session.id), ...agent.extraArgs()];
  const wsl = parseWslPath(session.cwd);
  return wsl
    ? `cd ${shellQuote(wsl.linuxPath)} && ${command.map(shellQuote).join(" ")}`
    : `Set-Location -LiteralPath ${powershellQuote(session.cwd)}; & ${command.map(powershellArg).join(" ")}`;
};
