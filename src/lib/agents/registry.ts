import { parseArgs } from "@/lib/args";
import { findTheme } from "@/lib/themes";
import { useSettingsStore } from "@/stores/settings-store";
import type { AgentId, ConfigAgent, CustomAgent } from "@/types";

export interface LaunchContext {
  subagent?: string;
}

interface AgentDefinition {
  id: AgentId;
  name: string;
  command: string[];
  history: boolean;
  assignsSessionIds: boolean;
  canFork: boolean;
  config: ConfigAgent | null;
  newArgs: (sessionId: string, context: LaunchContext) => string[];
  resumeArgs: (sessionId: string) => string[];
  forkArgs: (sessionId: string, newSessionId: string) => string[];
  extraArgs: (options?: { deckTheme?: boolean }) => string[];
}

export const CLAUDE: AgentId = "claude";
export const CODEX: AgentId = "codex";

const settings = () => useSettingsStore.getState();

const claudeThemeArgs = () => {
  const { matchAgentTheme, claudeArgs, themeId } = settings();
  if (!matchAgentTheme || /(^|\s)--settings(\s|=|$)/.test(claudeArgs)) return [];
  return ["--settings", JSON.stringify({ theme: `${findTheme(themeId).kind}-ansi` })];
};

const claude: AgentDefinition = {
  id: CLAUDE,
  name: "Claude",
  command: ["claude"],
  history: true,
  assignsSessionIds: true,
  canFork: true,
  config: "claude",
  newArgs: (sessionId, { subagent }) => [
    "--session-id",
    sessionId,
    ...(subagent ? ["--agent", subagent] : []),
  ],
  resumeArgs: (sessionId) => ["--resume", sessionId],
  forkArgs: (sessionId, newSessionId) => [
    "--resume",
    sessionId,
    "--fork-session",
    "--session-id",
    newSessionId,
  ],
  extraArgs: (options) => [
    ...(options?.deckTheme ? claudeThemeArgs() : []),
    ...parseArgs(settings().claudeArgs),
  ],
};

const codex: AgentDefinition = {
  id: CODEX,
  name: "Codex",
  command: ["codex"],
  history: true,
  assignsSessionIds: false,
  canFork: true,
  config: "codex",
  newArgs: () => [],
  resumeArgs: (sessionId) => ["resume", sessionId],
  forkArgs: (sessionId) => ["fork", sessionId],
  extraArgs: () => parseArgs(settings().codexArgs),
};

const fromCustom = (agent: CustomAgent): AgentDefinition => ({
  id: `custom:${agent.id}`,
  name: agent.name.trim() || parseArgs(agent.command)[0] || "Agent",
  command: parseArgs(agent.command),
  history: false,
  assignsSessionIds: false,
  canFork: false,
  config: null,
  newArgs: () => [],
  resumeArgs: () => [],
  forkArgs: () => [],
  extraArgs: () => [],
});

export const listAgents = (): AgentDefinition[] => [
  claude,
  codex,
  ...settings()
    .customAgents.filter((a) => a.command.trim())
    .map(fromCustom),
];

export const getAgent = (id: AgentId | undefined): AgentDefinition | null =>
  listAgents().find((a) => a.id === id) ?? null;

export const findAgent = (id: AgentId | undefined): AgentDefinition => getAgent(id) ?? claude;

export const agentName = (id: AgentId | undefined) => findAgent(id).name;

export const SUBAGENT_NAME = /^[\w:.-]+$/;
