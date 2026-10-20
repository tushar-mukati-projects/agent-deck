import { openElsewhere } from "@/lib/sessions";
import type { AgentTask, AgentTaskStatus, LiveSession, Subagent } from "@/types";

export type TaskState = AgentTaskStatus | "ended";

const RECENT_MS = 30 * 60_000;
const MAX_FINISHED = 5;
const START_SLACK_MS = 5_000;
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

const time = (value: string | null) => Date.parse(value ?? "");

export const processStart = (live: LiveSession[], sessionId: string) =>
  Math.max(0, ...live.filter((l) => l.sessionId === sessionId).map((l) => l.startedAt ?? 0));

export const agentStartedMs = (
  live: LiveSession[],
  ownPids: (number | null)[],
  sessionId: string,
  runningHere: boolean,
) =>
  runningHere || openElsewhere(live, ownPids, sessionId) ? processStart(live, sessionId) : null;

const fromThisRun = (task: Pick<AgentTask, "startedAt">, agentStartedMs: number) =>
  !(time(task.startedAt) < agentStartedMs - START_SLACK_MS);

export const taskState = (task: AgentTask, agentStartedMs: number | null): TaskState => {
  if (task.status !== "running") return task.status;
  return agentStartedMs !== null && fromThisRun(task, agentStartedMs) ? "running" : "ended";
};

export const shownTasks = (tasks: AgentTask[], agentStartedMs: number | null, now: number) => {
  if (agentStartedMs === null) return [];
  const current = tasks.filter((t) => fromThisRun(t, agentStartedMs));
  const running = current.filter((t) => t.status === "running");
  const finished = current
    .filter((t) => t.status !== "running" && now - time(t.endedAt ?? t.startedAt) < RECENT_MS)
    .slice(0, MAX_FINISHED);
  return [...running, ...finished];
};

export const agentShells = (
  tasks: AgentTask[] | undefined,
  agentStartedMs: number | null,
  hidden: boolean,
  now: number,
) => (hidden ? [] : shownTasks(tasks ?? [], agentStartedMs, now));

export const taskLabel = (task: AgentTask) => task.description?.trim() || task.command;

export const runningSubagents = (agents: Subagent[], agentStartedMs: number | null) =>
  agentStartedMs === null
    ? []
    : agents.filter((a) => a.status === "running" && fromThisRun(a, agentStartedMs)).reverse();

export const subagentLabel = (agent: Subagent) =>
  agent.description?.trim() || agent.agentType || "Subagent";

export const cleanOutput = (text: string) =>
  text
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.split("\r").filter(Boolean).at(-1) ?? "")
    .join("\n");
