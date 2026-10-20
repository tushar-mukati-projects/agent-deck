import { encodeMcpTab } from "@/lib/diff-tabs";
import { basename, dirname } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";
import type { PermissionRule } from "@/lib/agent-config/filter-overview";
import type {
  ConfigAgent,
  ConfigHook,
  ConfigItem,
  ConfigPlugin,
  ConfigRemoval,
  ConfigScope,
  McpServer,
  MemoryFile,
} from "@/types";

export interface RemovalRequest {
  removal: ConfigRemoval;
  name: string;
  description: string;
  closes?: string;
}

export const canRemove = (scope: ConfigScope) => scope !== "plugin" && scope !== "system";

const whereItGoes = (path: string) =>
  parseWslPath(path)
    ? "It's deleted from WSL for good."
    : "It goes to the Recycle Bin, so you can restore it.";

export const memoryRemoval = (file: MemoryFile): RemovalRequest => ({
  removal: { kind: "memory", path: file.path },
  name: file.label,
  description: `${whereItGoes(file.path)}${file.scope === "auto" ? " Its line in MEMORY.md goes too." : ""}`,
  closes: file.path,
});

export const skillRemoval = (skill: ConfigItem): RemovalRequest => ({
  removal: { kind: "skill", path: skill.path },
  name: skill.name,
  description: `Removes the whole skill folder. ${whereItGoes(skill.path)}`,
  closes: dirname(skill.path),
});

export const fileRemoval = (item: ConfigItem): RemovalRequest => ({
  removal: { kind: "file", path: item.path },
  name: item.name,
  description: whereItGoes(item.path),
  closes: item.path,
});

export const serverRemoval = (server: McpServer): RemovalRequest => ({
  removal: { kind: "mcpServer", id: server.id },
  name: server.name,
  description: `Removes it from ${basename(server.source)}.`,
  closes: encodeMcpTab(server.id),
});

export const hookRemoval = ({
  source,
  event,
  group,
  index,
  command,
}: ConfigHook): RemovalRequest => ({
  removal: { kind: "hook", source, event, group, index, command },
  name: `this ${event} hook`,
  description: `Removes it from ${basename(source)}.`,
});

export const ruleRemoval = ({ kind, rule, file }: PermissionRule): RemovalRequest => ({
  removal: { kind: "rule", path: file.path, list: kind, rule },
  name: `the ${kind} rule ${rule}`,
  description: `Removes it from ${file.label}.`,
});

export const pluginRemoval = (plugin: ConfigPlugin, agent: ConfigAgent): RemovalRequest => ({
  removal: { kind: "plugin", name: plugin.name },
  name: plugin.name.split("@")[0],
  description:
    agent === "claude"
      ? "Uninstalls it with claude plugin uninstall, along with its skills, agents, commands, hooks and servers."
      : "Removes it from config.toml and deletes its cached files.",
});
