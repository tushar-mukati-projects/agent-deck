import {
  Blocks,
  BookOpen,
  BrainCircuit,
  Database,
  FilePlus2,
  FileText,
  Plug,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareSlash,
  Terminal,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";

import { sendToAgent } from "@/actions/files";
import { startAgentSession } from "@/actions/sessions";
import { Hint } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { ListRow } from "@/components/ui/list-row";
import { ScopeBadge } from "@/components/ui/panel";
import { TimeAgo } from "@/components/ui/time-ago";
import {
  invocation,
  modeLabel,
  scopeLabel,
  serverDetail,
  type FilteredOverview,
} from "@/features/claude/filter-overview";
import { agentName } from "@/lib/agents/registry";
import { encodeMcpTab } from "@/lib/diff-tabs";
import { api } from "@/lib/tauri/commands";
import { revealInExplorer } from "@/lib/tauri/system";
import { cn, errorMessage } from "@/lib/utils";
import { useViewerStore } from "@/stores/viewer-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ConfigItem, Workspace } from "@/types";

export interface SectionProps {
  workspace: Workspace;
  data: FilteredOverview;
  reload: () => void;
}

const openFile = (workspace: Workspace, path: string) =>
  useWorkspaceStore.getState().openFile(workspace.id, path);

const createMemory = async (workspace: Workspace, path: string, reload: () => void) => {
  try {
    await api.createMemoryFile(path);
    openFile(workspace, path);
    useViewerStore.getState().setEditing(path, true);
    reload();
  } catch (error) {
    toast.error(errorMessage(error));
  }
};

const MemorySection = ({ workspace, data, reload }: SectionProps) => (
  <>
    {data.memory.map((file) =>
      file.exists ? (
        <ListRow
          key={file.path}
          icon={<FileText />}
          title={file.label}
          subtitle={file.description}
          badge={<ScopeBadge>{scopeLabel(file.scope)}</ScopeBadge>}
          meta={<TimeAgo ms={file.modifiedMs} />}
          onClick={() => openFile(workspace, file.path)}
        />
      ) : (
        <ListRow
          key={file.path}
          icon={<FilePlus2 />}
          title={`Create ${file.label}`}
          subtitle={
            file.scope === "user"
              ? "Personal instructions Claude reads in every folder."
              : "Project instructions Claude reads at the start of every session here."
          }
          dim
          onClick={() => void createMemory(workspace, file.path, reload)}
        />
      ),
    )}
  </>
);

const McpSection = ({ workspace, data }: SectionProps) => (
  <>
    {data.mcp.length === 0 && <Hint>No MCP servers configured for this folder.</Hint>}
    {data.mcp.map((server) => (
      <ListRow
        key={server.id}
        icon={server.postgres ? <Database className="text-info" /> : <Plug />}
        title={server.name}
        subtitle={serverDetail(server)}
        badge={
          <>
            <ScopeBadge>{scopeLabel(server.scope, server.plugin)}</ScopeBadge>
            <ScopeBadge>{server.transport}</ScopeBadge>
          </>
        }
        meta={server.disabled ? "disabled" : undefined}
        dim={server.disabled}
        onClick={() => openFile(workspace, encodeMcpTab(server.id))}
      />
    ))}
  </>
);

const ItemRows = ({
  items,
  icon,
  workspace,
  kind,
}: {
  items: ConfigItem[];
  icon: React.ReactNode;
  workspace: Workspace;
  kind: "slash" | "agent";
}) => (
  <>
    {items.map((item) => (
      <ListRow
        key={item.path}
        icon={icon}
        title={kind === "slash" ? `/${invocation(item)}` : item.name}
        mono={kind === "slash"}
        subtitle={item.description}
        badge={<ScopeBadge>{scopeLabel(item.scope, item.plugin)}</ScopeBadge>}
        onClick={() => openFile(workspace, item.path)}
        actions={
          kind === "agent" ? (
            <IconButton
              label={`New session with ${item.name}`}
              onClick={() => startAgentSession(workspace.cwd, item.name)}
            >
              <Sparkles />
            </IconButton>
          ) : (
            <IconButton
              label={`Type /${invocation(item)} in ${agentName(workspace.agent)}`}
              onClick={() => sendToAgent(workspace, `/${invocation(item)} `)}
            >
              <Terminal />
            </IconButton>
          )
        }
      />
    ))}
  </>
);

const SkillsSection = ({ workspace, data }: SectionProps) => (
  <>
    {data.skills.length === 0 && <Hint>No skills found.</Hint>}
    <ItemRows items={data.skills} icon={<BookOpen />} workspace={workspace} kind="slash" />
  </>
);

const AgentsSection = ({ workspace, data }: SectionProps) => (
  <>
    {data.agents.length === 0 && <Hint>No agents in ~/.claude/agents or .claude/agents.</Hint>}
    <ItemRows items={data.agents} icon={<Sparkles />} workspace={workspace} kind="agent" />
  </>
);

const CommandsSection = ({ workspace, data }: SectionProps) => (
  <>
    {data.commands.length === 0 && <Hint>No custom slash commands.</Hint>}
    <ItemRows items={data.commands} icon={<SquareSlash />} workspace={workspace} kind="slash" />
  </>
);

const HooksSection = ({ workspace, data }: SectionProps) => (
  <>
    {data.hooks.length === 0 && <Hint>No hooks configured.</Hint>}
    {data.hooks.map((hook, index) => (
      <ListRow
        key={`${hook.source}:${index}`}
        icon={<Webhook />}
        title={hook.matcher ? `${hook.event} · ${hook.matcher}` : hook.event}
        subtitle={hook.command}
        badge={<ScopeBadge>{scopeLabel(hook.scope, hook.plugin)}</ScopeBadge>}
        onClick={() => openFile(workspace, hook.source)}
      />
    ))}
  </>
);

const RULE_TONE = { allow: "text-success", deny: "text-danger", ask: "text-warning" } as const;

const PermissionsSection = ({ workspace, data }: SectionProps) => (
  <>
    {data.modes.map((file) => (
      <ListRow
        key={`mode:${file.path}`}
        icon={<Settings2 />}
        title={modeLabel(file)}
        badge={<ScopeBadge>{scopeLabel(file.scope)}</ScopeBadge>}
        onClick={() => openFile(workspace, file.path)}
      />
    ))}
    {data.permissions.length === 0 && <Hint>No allow, ask or deny rules.</Hint>}
    {data.permissions.map(({ kind, rule, file }, index) => (
      <ListRow
        key={`${file.path}:${kind}:${index}`}
        icon={<ShieldCheck className={cn(RULE_TONE[kind])} />}
        title={rule}
        mono
        badge={<ScopeBadge>{kind}</ScopeBadge>}
        meta={scopeLabel(file.scope)}
        onClick={() => openFile(workspace, file.path)}
      />
    ))}
  </>
);

const PluginsSection = ({ data }: SectionProps) => (
  <>
    {data.plugins.length === 0 && <Hint>No plugins installed.</Hint>}
    {data.plugins.map((plugin) => {
      const [name, source] = plugin.name.split("@");
      return (
        <ListRow
          key={`${plugin.scope}:${plugin.name}:${plugin.path}`}
          icon={<Blocks />}
          title={name}
          subtitle={source ? `from ${source}` : null}
          badge={<ScopeBadge>{plugin.scope}</ScopeBadge>}
          meta={plugin.enabled ? plugin.version : "disabled"}
          dim={!plugin.enabled}
          onClick={() => void revealInExplorer(plugin.path)}
        />
      );
    })}
  </>
);

const SettingsSection = ({ workspace, data }: SectionProps) => (
  <>
    {data.settings.map((file) => (
      <ListRow
        key={file.path}
        icon={<Settings2 />}
        title={file.label}
        subtitle={
          file.error ? `Invalid JSON: ${file.error}` : file.exists ? file.path : "Not created yet"
        }
        badge={<ScopeBadge>{scopeLabel(file.scope)}</ScopeBadge>}
        meta={file.error ? <span className="text-danger">error</span> : undefined}
        dim={!file.exists}
        disabled={!file.exists}
        onClick={() => openFile(workspace, file.path)}
      />
    ))}
  </>
);

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

export const SECTIONS: {
  key: SectionKey;
  title: string;
  icon: React.ReactNode;
  count: (data: FilteredOverview) => number;
  Body: (props: SectionProps) => React.ReactNode;
}[] = [
  {
    key: "memory",
    title: "Memory",
    icon: <BrainCircuit />,
    count: (d) => d.memory.filter((m) => m.exists).length,
    Body: MemorySection,
  },
  {
    key: "mcp",
    title: "MCP servers",
    icon: <Plug />,
    count: (d) => d.mcp.length,
    Body: McpSection,
  },
  {
    key: "skills",
    title: "Skills",
    icon: <BookOpen />,
    count: (d) => d.skills.length,
    Body: SkillsSection,
  },
  {
    key: "agents",
    title: "Agents",
    icon: <Sparkles />,
    count: (d) => d.agents.length,
    Body: AgentsSection,
  },
  {
    key: "commands",
    title: "Slash commands",
    icon: <SquareSlash />,
    count: (d) => d.commands.length,
    Body: CommandsSection,
  },
  {
    key: "hooks",
    title: "Hooks",
    icon: <Webhook />,
    count: (d) => d.hooks.length,
    Body: HooksSection,
  },
  {
    key: "permissions",
    title: "Permissions",
    icon: <ShieldCheck />,
    count: (d) => d.permissions.length,
    Body: PermissionsSection,
  },
  {
    key: "plugins",
    title: "Plugins",
    icon: <Blocks />,
    count: (d) => d.plugins.length,
    Body: PluginsSection,
  },
  {
    key: "settings",
    title: "Settings files",
    icon: <Settings2 />,
    count: (d) => d.settings.filter((s) => s.exists).length,
    Body: SettingsSection,
  },
];
