import type { AgentOverview, ConfigItem, ConfigScope, McpServer, SettingsFile } from "@/types";

export type RuleKind = "allow" | "ask" | "deny";

export interface PermissionRule {
  kind: RuleKind;
  rule: string;
  file: SettingsFile;
}

const SCOPE_LABELS: Partial<Record<ConfigScope, string>> = {
  auto: "auto memory",
  system: "built-in",
};

export const scopeLabel = (scope: ConfigScope, plugin?: string | null) =>
  plugin ?? SCOPE_LABELS[scope] ?? scope;

export const serverDetail = (server: McpServer) =>
  server.url ?? [server.command, ...server.args].filter(Boolean).join(" ");

export const invocation = (item: ConfigItem) =>
  item.plugin && !item.name.startsWith(`${item.plugin}:`)
    ? `${item.plugin}:${item.name}`
    : item.name;

export const modeLabel = (file: SettingsFile) =>
  [file.defaultMode && `Mode: ${file.defaultMode}`, file.model && `Model: ${file.model}`]
    .filter(Boolean)
    .join(" · ");

const matches = (query: string, ...fields: (string | null | undefined)[]) =>
  !query || fields.some((f) => f?.toLowerCase().includes(query));

export const filterOverview = (overview: AgentOverview, query: string) => {
  const items = (list: ConfigItem[]) =>
    list.filter((i) => matches(query, i.name, i.description, i.plugin));
  const permissions: PermissionRule[] = overview.settings.flatMap((file) =>
    (["allow", "ask", "deny"] as const).flatMap((kind) =>
      file[kind].map((rule) => ({ kind, rule, file })),
    ),
  );
  return {
    memory: overview.memory.filter((m) => matches(query, m.label, m.description, m.path)),
    mcp: overview.mcp.filter((s) => matches(query, s.name, s.plugin, serverDetail(s))),
    skills: items(overview.skills),
    agents: items(overview.agents),
    commands: items(overview.commands),
    hooks: overview.hooks.filter((h) => matches(query, h.event, h.matcher, h.command, h.plugin)),
    permissions: permissions.filter((p) => matches(query, p.rule, p.kind)),
    modes: overview.settings.filter(
      (s) => (s.defaultMode || s.model) && matches(query, modeLabel(s), s.label),
    ),
    plugins: overview.plugins.filter((p) => matches(query, p.name)),
    settings: overview.settings.filter((s) => matches(query, s.label, s.path)),
  };
};

export type FilteredOverview = ReturnType<typeof filterOverview>;
