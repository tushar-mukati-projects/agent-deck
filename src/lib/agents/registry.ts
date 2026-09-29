import { parseArgs } from "@/lib/args";
import { useSettingsStore } from "@/stores/settings-store";
import type { AgentId, CustomAgent } from "@/types";

export interface LaunchContext {
  subagent?: string;
}

export interface AgentDefinition {
  id: AgentId;
  name: string;
  command: string[];
  history: boolean;
  assignsSessionIds: boolean;
  canFork: boolean;
  newArgs: (sessionId: string, context: LaunchContext) => string[];
  resumeArgs: (sessionId: string) => string[];
  forkArgs: (sessionId: string, newSessionId: string) => string[];
}

export const CLAUDE: AgentId = "claude";
export const CODEX: AgentId = "codex";

const extra = (key: "claudeArgs" | "codexArgs") => parseArgs(useSettingsStore.getState()[key]);

const claude: AgentDefinition = {
  id: CLAUDE,
  name: "Claude",
  command: ["claude"],
  history: true,
  assignsSessionIds: true,
  canFork: true,
  newArgs: (sessionId, { subagent }) => [
    "--session-id",
    sessionId,
    ...(subagent ? ["--agent", subagent] : []),
    ...extra("claudeArgs"),
  ],
  resumeArgs: (sessionId) => ["--resume", sessionId, ...extra("claudeArgs")],
  forkArgs: (sessionId, newSessionId) => [
    "--resume",
    sessionId,
    "--fork-session",
    "--session-id",
    newSessionId,
    ...extra("claudeArgs"),
  ],
};

const codex: AgentDefinition = {
  id: CODEX,
  name: "Codex",
  command: ["codex"],
  history: true,
  assignsSessionIds: false,
  canFork: true,
  newArgs: () => extra("codexArgs"),
  resumeArgs: (sessionId) => ["resume", sessionId, ...extra("codexArgs")],
  forkArgs: (sessionId) => ["fork", sessionId, ...extra("codexArgs")],
};

export const customAgentId = (agent: CustomAgent) => `custom:${agent.id}`;

const fromCustom = (agent: CustomAgent): AgentDefinition => ({
  id: customAgentId(agent),
  name: agent.name.trim() || agent.command.trim().split(/\s+/)[0] || "Agent",
  command: parseArgs(agent.command),
  history: false,
  assignsSessionIds: false,
  canFork: false,
  newArgs: () => [],
  resumeArgs: () => [],
  forkArgs: () => [],
});

export const listAgents = (): AgentDefinition[] => [
  claude,
  codex,
  ...useSettingsStore
    .getState()
    .customAgents.filter((a) => a.command.trim())
    .map(fromCustom),
];

export const findAgent = (id: AgentId | undefined): AgentDefinition =>
  listAgents().find((a) => a.id === id) ?? claude;

export const agentName = (id: AgentId | undefined) => findAgent(id).name;
