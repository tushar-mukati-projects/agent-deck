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
  Trash2,
  Webhook,
} from "lucide-react";

import { removeConfig } from "@/actions/agent-config";
import { sendToAgent } from "@/actions/files";
import { startAgentSession } from "@/actions/sessions";
import { Hint, showError } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { ListRow } from "@/components/ui/list-row";
import { Tag } from "@/components/ui/tag";
import { TimeAgo } from "@/components/ui/time-ago";
import {
  modeLabel,
  scopeLabel,
  serverDetail,
  type FilteredOverview,
} from "@/lib/agent-config/filter-overview";
import {
  canRemove,
  fileRemoval,
  hookRemoval,
  memoryRemoval,
  pluginRemoval,
  ruleRemoval,
  serverRemoval,
  skillRemoval,
  type RemovalRequest,
} from "@/lib/agent-config/removals";
import { encodeMcpTab } from "@/lib/diff-tabs";
import { dangerHoverClass } from "@/lib/styles";
import { api } from "@/lib/tauri/commands";
import { revealInExplorer } from "@/lib/tauri/system";
import { useViewerStore } from "@/stores/viewer-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AgentProfile, SectionKey } from "@/lib/agent-config/profiles";
import type { ConfigAgent, ConfigItem, Workspace } from "@/types";

interface SectionProps {
  workspace: Workspace;
  agent: ConfigAgent;
  profile: AgentProfile;
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
    showError(error);
  }
};

const RemoveButton = ({
  workspace,
  agent,
  request,
}: {
  workspace: Workspace;
  agent: ConfigAgent;
  request: RemovalRequest;
}) => (
  <IconButton
    label={`Remove ${request.name}`}
    className={dangerHoverClass}
    onClick={() => void removeConfig(workspace, agent, request)}
  >
    <Trash2 />
  </IconButton>
);

const MemorySection = ({ workspace, agent, profile, data, reload }: SectionProps) => (
  <>
    {data.memory.map((file) =>
      file.exists ? (
        <ListRow
          key={file.path}
          icon={<FileText />}
          title={file.label}
          subtitle={file.description}
          badge={<Tag>{scopeLabel(file.scope)}</Tag>}
          meta={<TimeAgo ms={file.modifiedMs} />}
          onClick={() => openFile(workspace, file.path)}
          actions={
            <RemoveButton workspace={workspace} agent={agent} request={memoryRemoval(file)} />
          }
        />
      ) : (
        <ListRow
          key={file.path}
          icon={<FilePlus2 />}
          title={`Create ${file.label}`}
          subtitle={
            file.scope === "user"
              ? `Personal instructions ${profile.name} reads in every folder.`
              : `Project instructions ${profile.name} reads at the start of every session here.`
          }
          dim
          onClick={() => void createMemory(workspace, file.path, reload)}
        />
      ),
    )}
  </>
);

const McpSection = ({ workspace, agent, profile, data }: SectionProps) => (
  <>
    {data.mcp.length === 0 && <Hint>{profile.empty.mcp}</Hint>}
    {data.mcp.map((server) => (
      <ListRow
        key={server.id}
        icon={server.postgres ? <Database className="text-info" /> : <Plug />}
        title={server.name}
        subtitle={serverDetail(server)}
        badge={
          <>
            <Tag>{scopeLabel(server.scope, server.plugin)}</Tag>
            <Tag>{server.transport}</Tag>
          </>
        }
        meta={server.disabled ? "disabled" : undefined}
        dim={server.disabled}
        onClick={() => openFile(workspace, encodeMcpTab(server.id))}
        actions={
          canRemove(server.scope) && (
            <RemoveButton workspace={workspace} agent={agent} request={serverRemoval(server)} />
          )
        }
      />
    ))}
  </>
);

const ItemAction = ({
  workspace,
  profile,
  item,
  kind,
}: {
  workspace: Workspace;
  profile: AgentProfile;
  item: ConfigItem;
  kind: "skill" | "command" | "agent";
}) => {
  if (kind === "agent")
    return (
      <IconButton
        label={`New session with ${item.name}`}
        onClick={() => startAgentSession(workspace.cwd, item.name)}
      >
        <Sparkles />
      </IconButton>
    );
  const typed = profile.typed(item, kind);
  return (
    <IconButton
      label={`Type ${typed} in ${profile.name}`}
      onClick={() => sendToAgent(workspace, `${typed} `)}
    >
      <Terminal />
    </IconButton>
  );
};

const ItemRows = ({
  workspace,
  agent,
  profile,
  items,
  icon,
  kind,
}: Omit<SectionProps, "data" | "reload"> & {
  items: ConfigItem[];
  icon: React.ReactNode;
  kind: "skill" | "command" | "agent";
}) => (
  <>
    {items.map((item) => (
      <ListRow
        key={item.path}
        icon={icon}
        title={kind === "agent" ? item.name : profile.typed(item, kind)}
        mono={kind !== "agent"}
        subtitle={item.description}
        badge={<Tag>{scopeLabel(item.scope, item.plugin)}</Tag>}
        onClick={() => openFile(workspace, item.path)}
        actions={
          <>
            <ItemAction workspace={workspace} profile={profile} item={item} kind={kind} />
            {canRemove(item.scope) && (
              <RemoveButton
                workspace={workspace}
                agent={agent}
                request={kind === "skill" ? skillRemoval(item) : fileRemoval(item)}
              />
            )}
          </>
        }
      />
    ))}
  </>
);

const SkillsSection = ({ data, ...props }: SectionProps) => (
  <>
    {data.skills.length === 0 && <Hint>{props.profile.empty.skills}</Hint>}
    <ItemRows {...props} items={data.skills} icon={<BookOpen />} kind="skill" />
  </>
);

const AgentsSection = ({ data, ...props }: SectionProps) => (
  <>
    {data.agents.length === 0 && <Hint>{props.profile.empty.agents}</Hint>}
    <ItemRows {...props} items={data.agents} icon={<Sparkles />} kind="agent" />
  </>
);

const CommandsSection = ({ data, ...props }: SectionProps) => (
  <>
    {data.commands.length === 0 && <Hint>{props.profile.empty.commands}</Hint>}
    <ItemRows {...props} items={data.commands} icon={<SquareSlash />} kind="command" />
  </>
);

const HooksSection = ({ workspace, agent, profile, data }: SectionProps) => (
  <>
    {data.hooks.length === 0 && <Hint>{profile.empty.hooks}</Hint>}
    {data.hooks.map((hook) => (
      <ListRow
        key={`${hook.source}:${hook.event}:${hook.group}:${hook.index}`}
        icon={<Webhook />}
        title={hook.matcher ? `${hook.event} · ${hook.matcher}` : hook.event}
        subtitle={hook.command}
        badge={<Tag>{scopeLabel(hook.scope, hook.plugin)}</Tag>}
        onClick={() => openFile(workspace, hook.source)}
        actions={
          canRemove(hook.scope) && (
            <RemoveButton workspace={workspace} agent={agent} request={hookRemoval(hook)} />
          )
        }
      />
    ))}
  </>
);

const RULE_TONE = { allow: "text-success", deny: "text-danger", ask: "text-warning" } as const;

const PermissionsSection = ({ workspace, agent, profile, data }: SectionProps) => (
  <>
    {data.modes.map((file) => (
      <ListRow
        key={`mode:${file.path}`}
        icon={<Settings2 />}
        title={modeLabel(file)}
        badge={<Tag>{scopeLabel(file.scope)}</Tag>}
        onClick={() => openFile(workspace, file.path)}
      />
    ))}
    {data.permissions.length === 0 && <Hint>{profile.empty.permissions}</Hint>}
    {data.permissions.map((permission, index) => (
      <ListRow
        key={`${permission.file.path}:${permission.kind}:${index}`}
        icon={<ShieldCheck className={RULE_TONE[permission.kind]} />}
        title={permission.rule}
        mono
        badge={<Tag>{permission.kind}</Tag>}
        meta={scopeLabel(permission.file.scope)}
        onClick={() => openFile(workspace, permission.file.path)}
        actions={
          <RemoveButton workspace={workspace} agent={agent} request={ruleRemoval(permission)} />
        }
      />
    ))}
  </>
);

const PluginsSection = ({ workspace, agent, profile, data }: SectionProps) => (
  <>
    {data.plugins.length === 0 && <Hint>{profile.empty.plugins}</Hint>}
    {data.plugins.map((plugin) => {
      const [name, source] = plugin.name.split("@");
      return (
        <ListRow
          key={`${plugin.scope}:${plugin.name}:${plugin.path}`}
          icon={<Blocks />}
          title={name}
          subtitle={source ? `from ${source}` : null}
          badge={<Tag>{plugin.scope}</Tag>}
          meta={plugin.enabled ? plugin.version : "disabled"}
          dim={!plugin.enabled}
          onClick={() => void revealInExplorer(plugin.path)}
          actions={
            <RemoveButton
              workspace={workspace}
              agent={agent}
              request={pluginRemoval(plugin, agent)}
            />
          }
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
        subtitle={file.error ? file.error : file.exists ? file.path : "Not created yet"}
        badge={<Tag>{scopeLabel(file.scope)}</Tag>}
        meta={file.error ? <span className="text-danger">error</span> : undefined}
        dim={!file.exists}
        disabled={!file.exists}
        onClick={() => openFile(workspace, file.path)}
      />
    ))}
  </>
);

export const SECTIONS: Record<
  SectionKey,
  {
    title: string;
    icon: React.ReactNode;
    count: (data: FilteredOverview) => number;
    Body: (props: SectionProps) => React.ReactNode;
  }
> = {
  memory: {
    title: "Memory",
    icon: <BrainCircuit />,
    count: (d) => d.memory.filter((m) => m.exists).length,
    Body: MemorySection,
  },
  mcp: { title: "MCP servers", icon: <Plug />, count: (d) => d.mcp.length, Body: McpSection },
  skills: {
    title: "Skills",
    icon: <BookOpen />,
    count: (d) => d.skills.length,
    Body: SkillsSection,
  },
  agents: {
    title: "Agents",
    icon: <Sparkles />,
    count: (d) => d.agents.length,
    Body: AgentsSection,
  },
  commands: {
    title: "Commands",
    icon: <SquareSlash />,
    count: (d) => d.commands.length,
    Body: CommandsSection,
  },
  hooks: { title: "Hooks", icon: <Webhook />, count: (d) => d.hooks.length, Body: HooksSection },
  permissions: {
    title: "Permissions",
    icon: <ShieldCheck />,
    count: (d) => d.permissions.length,
    Body: PermissionsSection,
  },
  plugins: {
    title: "Plugins",
    icon: <Blocks />,
    count: (d) => d.plugins.length,
    Body: PluginsSection,
  },
  settings: {
    title: "Settings files",
    icon: <Settings2 />,
    count: (d) => d.settings.filter((s) => s.exists).length,
    Body: SettingsSection,
  },
};
