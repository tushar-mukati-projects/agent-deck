import { useState } from "react";
import { Bot, ChevronDown } from "lucide-react";

import { StatusDot } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { panelTabClass, Tab, TabStrip } from "@/components/ui/tabs";
import { TranscriptList } from "@/features/workspace/TranscriptList";
import { useSubagentTranscript } from "@/features/workspace/useSubagentTranscript";
import { useSessionFile } from "@/hooks/useSessionFile";
import { subagentLabel } from "@/lib/agent-tasks";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import type { Subagent, Workspace } from "@/types";

type SubagentViewProps = {
  workspace: Workspace;
  agent: Subagent;
};

const SubagentView = ({ workspace, agent }: SubagentViewProps) => {
  const { filePath, distro } = useSessionFile(workspace);
  const { items, error } = useSubagentTranscript(filePath, distro, agent.agentId ?? agent.id);
  return (
    <TranscriptList
      items={items}
      error={error}
      query=""
      emptyDescription="What this subagent does shows up here as it works."
      baseDir={workspace.cwd}
      workspaceId={workspace.id}
    />
  );
};

type SubagentsPanelProps = {
  workspace: Workspace;
  agents: Subagent[];
};

export const SubagentsPanel = ({ workspace, agents }: SubagentsPanelProps) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = agents.find((a) => a.id === selectedId) ?? agents[0];
  if (!selected) return null;

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-1 px-2 py-1">
        <Bot className="mr-1 size-3.5 shrink-0 text-faint" />
        <TabStrip label="Subagents" className="h-full min-w-0 flex-1 items-center gap-0.5">
          {agents.map((agent) => (
            <Tab
              key={agent.id}
              selected={agent.id === selected.id}
              onSelect={() => setSelectedId(agent.id)}
              title={agent.agentType ? `${subagentLabel(agent)} · ${agent.agentType}` : undefined}
              className={cn(panelTabClass(agent.id === selected.id), "pr-2")}
            >
              <StatusDot tone="running" className="size-1.5" />
              <span className="max-w-[220px] truncate">{subagentLabel(agent)}</span>
            </Tab>
          ))}
        </TabStrip>
        <IconButton
          label="Hide subagents"
          onClick={() => useUiStore.getState().setSubagentsOpen(false)}
        >
          <ChevronDown />
        </IconButton>
      </div>
      <SubagentView key={selected.id} workspace={workspace} agent={selected} />
    </div>
  );
};
