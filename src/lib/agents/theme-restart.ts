import { isPersisted, planLaunch, type LaunchEnvironment } from "@/lib/agents/launch";
import { CLAUDE } from "@/lib/agents/registry";
import type { LiveSession, SessionInfo, TerminalState, Workspace } from "@/types";

const TYPING_GRACE_MS = 5_000;

export interface RestartContext {
  terminal: TerminalState | undefined;
  live: LiveSession[];
  sessions: Record<string, SessionInfo>;
  input: { typedAt: number; hasDraft: boolean } | null;
  now: number;
}

export const launchTheme = (args: string[]) => {
  const index = args.indexOf("--settings");
  if (index < 0) return null;
  try {
    const theme: unknown = JSON.parse(args[index + 1] ?? "")?.theme;
    return typeof theme === "string" ? theme : null;
  } catch {
    return null;
  }
};

export const themeOutdated = (workspace: Workspace, launch: LaunchEnvironment) =>
  workspace.agent === CLAUDE &&
  workspace.mode === "live" &&
  !!workspace.agentTerminalId &&
  launchTheme(workspace.agentArgs) !== launchTheme(planLaunch(workspace, launch).args);

const claudeIsIdle = (workspace: Workspace, terminal: TerminalState, live: LiveSession[]) => {
  const records = live.filter((l) => l.sessionId === workspace.sessionId);
  const own = records.filter((l) => l.pid === terminal.pid);
  const relevant = own.length ? own : records;
  return relevant.length > 0 && relevant.every((l) => l.status === "idle");
};

export const readyToRestart = (
  workspace: Workspace,
  { terminal, live, sessions, input, now }: RestartContext,
) => {
  if (terminal?.status !== "running" || terminal.busy || !input) return false;
  if (input.hasDraft || now - input.typedAt < TYPING_GRACE_MS) return false;
  const resumable = isPersisted(workspace, sessions);
  if (!resumable && (input.typedAt > 0 || workspace.agentArgs.includes("--resume"))) return false;
  return claudeIsIdle(workspace, terminal, live);
};
