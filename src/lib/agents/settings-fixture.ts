import type { LaunchEnvironment } from "@/lib/agents/launch";
import type { AgentSettings } from "@/lib/agents/registry";

export const agentSettings = (extra: Partial<AgentSettings> = {}): AgentSettings => ({
  claudeArgs: "",
  codexArgs: "",
  customAgents: [],
  matchAgentTheme: false,
  themeId: "aurora",
  ...extra,
});

export const testLaunch = (extra: Partial<AgentSettings> = {}): LaunchEnvironment => ({
  settings: { ...agentSettings(extra), shellProgram: "" },
  environment: null,
  sessions: {},
});
