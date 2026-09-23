import { parseArgs } from "@/lib/args";
import type { TerminalSpec } from "@/lib/terminal/registry";
import { newId } from "@/lib/utils";
import { parseWslPath, shellQuote } from "@/lib/wsl";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { ShellTab, Workspace } from "@/types";

export interface LaunchOptions {
  fork?: boolean;
  agent?: string;
}

export interface LaunchPlan {
  sessionId: string;
  args: string[];
}

const extraArgs = () => parseArgs(useSettingsStore.getState().claudeArgs);

const windowsHome = () => useSessionsStore.getState().environment?.home ?? "C:\\";

export const isPersisted = (workspace: Pick<Workspace, "sessionId" | "filePath">) =>
  !!workspace.filePath || !!useSessionsStore.getState().byId[workspace.sessionId];

export const planLaunch = (workspace: Workspace, options: LaunchOptions = {}): LaunchPlan => {
  const agent = options.agent ? ["--agent", options.agent] : [];
  if (!isPersisted(workspace)) {
    return {
      sessionId: workspace.sessionId,
      args: ["--session-id", workspace.sessionId, ...agent, ...extraArgs()],
    };
  }
  if (options.fork) {
    const sessionId = newId();
    return {
      sessionId,
      args: [
        "--resume",
        workspace.sessionId,
        "--fork-session",
        "--session-id",
        sessionId,
        ...extraArgs(),
      ],
    };
  }
  return {
    sessionId: workspace.sessionId,
    args: ["--resume", workspace.sessionId, ...extraArgs()],
  };
};

export const defaultShellProgram = () =>
  useSettingsStore.getState().shellProgram.trim() ||
  useSessionsStore.getState().environment?.shell ||
  "powershell.exe";

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

export const claudeSpec = (workspace: Workspace & { claudeTerminalId: string }): TerminalSpec => ({
  id: workspace.claudeTerminalId,
  kind: "claude",
  workspaceId: workspace.id,
  root: workspace.cwd,
  ...(wslLaunch(workspace.cwd, ["claude", ...workspace.claudeArgs]) ?? {
    cwd: workspace.cwd,
    program: "claude",
    args: workspace.claudeArgs,
  }),
});

export const shellSpec = (workspaceId: string, shell: ShellTab): TerminalSpec => ({
  id: shell.id,
  kind: "shell",
  workspaceId,
  root: shell.cwd,
  initialInput: shell.command,
  ...(wslLaunch(shell.cwd, null) ?? { cwd: shell.cwd, program: shell.program, args: [] }),
});
