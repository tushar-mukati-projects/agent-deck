import { invocation } from "@/lib/agent-config/filter-overview";
import { basename } from "@/lib/utils";
import type { ConfigAgent, ConfigItem } from "@/types";

export type SectionKey =
  | "memory"
  | "mcp"
  | "skills"
  | "agents"
  | "commands"
  | "hooks"
  | "permissions"
  | "plugins"
  | "settings";

export interface AgentProfile {
  name: string;
  sections: SectionKey[];
  titles: Partial<Record<SectionKey, string>>;
  empty: Partial<Record<SectionKey, string>>;
  typed: (item: ConfigItem, kind: "skill" | "command") => string;
}

const CLAUDE: AgentProfile = {
  name: "Claude",
  sections: [
    "memory",
    "mcp",
    "skills",
    "agents",
    "commands",
    "hooks",
    "permissions",
    "plugins",
    "settings",
  ],
  titles: { commands: "Slash commands" },
  empty: {
    mcp: "No MCP servers configured for this folder.",
    skills: "No skills found.",
    agents: "No agents in ~/.claude/agents or .claude/agents.",
    commands: "No custom slash commands.",
    hooks: "No hooks configured.",
    permissions: "No allow, ask or deny rules.",
    plugins: "No plugins installed.",
  },
  typed: (item) => `/${invocation(item)}`,
};

const CODEX: AgentProfile = {
  name: "Codex",
  sections: ["memory", "mcp", "skills", "commands", "permissions", "plugins", "settings"],
  titles: { commands: "Prompts", permissions: "Rules" },
  empty: {
    mcp: "No MCP servers in config.toml.",
    skills: "No skills found.",
    commands: "No custom prompts in ~/.codex/prompts.",
    permissions: "No command rules yet.",
    plugins: "No plugins installed.",
  },
  typed: (item, kind) =>
    kind === "skill" ? `$${item.name}` : `/prompts:${basename(item.path).replace(/\.md$/i, "")}`,
};

export const PROFILES: Record<ConfigAgent, AgentProfile> = { claude: CLAUDE, codex: CODEX };

export const serverAgent = (serverId: string): ConfigAgent =>
  serverId.startsWith("codex:") ? "codex" : "claude";
