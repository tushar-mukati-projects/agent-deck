import { Sparkles, Terminal } from "lucide-react";

import { sendToAgent } from "@/actions/files";
import { startAgentSession } from "@/actions/sessions";
import { IconButton } from "@/components/ui/icon-button";
import { ListRow } from "@/components/ui/list-row";
import { Tag } from "@/components/ui/tag";
import { RemoveButton } from "@/features/agent-config/RemoveButton";
import { scopeLabel } from "@/lib/agent-config/filter-overview";
import { canRemove, fileRemoval, skillRemoval } from "@/lib/agent-config/removals";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AgentProfile } from "@/lib/agent-config/profiles";
import type { ConfigAgent, ConfigItem, Workspace } from "@/types";

type ItemKind = "skill" | "command" | "agent";

type ItemActionProps = {
  workspace: Workspace;
  profile: AgentProfile;
  item: ConfigItem;
  kind: ItemKind;
};

const ItemAction = ({ workspace, profile, item, kind }: ItemActionProps) => {
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

type ItemRowsProps = {
  workspace: Workspace;
  agent: ConfigAgent;
  profile: AgentProfile;
  items: ConfigItem[];
  icon: React.ReactNode;
  kind: ItemKind;
};

export const ItemRows = ({ workspace, agent, profile, items, icon, kind }: ItemRowsProps) => (
  <>
    {items.map((item) => (
      <ListRow
        key={item.path}
        icon={icon}
        title={kind === "agent" ? item.name : profile.typed(item, kind)}
        mono={kind !== "agent"}
        subtitle={item.description ?? undefined}
        badge={<Tag>{scopeLabel(item.scope, item.plugin)}</Tag>}
        onClick={() => useWorkspaceStore.getState().openFile(workspace.id, item.path)}
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
