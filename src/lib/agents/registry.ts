import { parseArgs } from "@/lib/args";
import { findTheme } from "@/lib/themes";
import type { SettingsData } from "@/stores/settings-store";
import type { AgentId, ConfigAgent, CustomAgent } from "@/types";

export type AgentSettings = Pick<
  SettingsData,
  "claudeArgs" | "codexArgs" | "matchAgentTheme" | "themeId" | "customAgents"
>;

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

export const customAgentId = (id: string): AgentId => `custom:${id}`;

const claudeThemeArgs = ({ matchAgentTheme, claudeArgs, themeId }: AgentSettings) => {
  if (!matchAgentTheme || /(^|\s)--settings(\s|=|$)/.test(claudeArgs)) return [];
  return ["--settings", JSON.stringify({ theme: `${findTheme(themeId).kind}-ansi` })];
};

const claude = (settings: AgentSettings): AgentDefinition => ({
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
    ...(options?.deckTheme ? claudeThemeArgs(settings) : []),
    ...parseArgs(settings.claudeArgs),
  ],
});

const codex = (settings: AgentSettings): AgentDefinition => ({
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
  extraArgs: () => parseArgs(settings.codexArgs),
});

const fromCustom = (agent: CustomAgent): AgentDefinition => ({
  id: customAgentId(agent.id),
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

export const listAgents = (settings: AgentSettings): AgentDefinition[] => [
  claude(settings),
  codex(settings),
  ...settings.customAgents.filter((a) => a.command.trim()).map(fromCustom),
];

export const getAgent = (id: AgentId | undefined, settings: AgentSettings) =>
  listAgents(settings).find((a) => a.id === id) ?? null;

export const findAgent = (id: AgentId | undefined, settings: AgentSettings) =>
  getAgent(id, settings) ?? claude(settings);

export const agentName = (id: AgentId | undefined, settings: AgentSettings) =>
  findAgent(id, settings).name;

export const resumeLabel = (
  agent: Pick<AgentDefinition, "id" | "name" | "history">,
  persisted: boolean,
) => {
  if (!persisted || !agent.history) return `Start ${agent.name}`;
  return agent.id === CLAUDE ? "Resume session" : `Resume in ${agent.name}`;
};

export const SUBAGENT_NAME = /^[\w:.-]+$/;
