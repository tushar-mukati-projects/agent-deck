import { memo, useDeferredValue, useMemo, useState } from "react";
import { BrainCircuit, RefreshCw } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { EmptyState, LoadingState } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { PanelHeader } from "@/components/ui/panel-header";
import { SearchInput } from "@/components/ui/search-input";
import { SECTIONS } from "@/features/agent-config/sections";
import { StartDistroButton } from "@/features/sidebar/WslStatus";
import { useToggleSet } from "@/hooks/useToggleSet";
import { filterOverview } from "@/lib/agent-config/filter-overview";
import { PROFILES, type SectionKey } from "@/lib/agent-config/profiles";
import { basename, cn } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";
import { agentName, getAgent } from "@/stores/agents";
import { useOverview } from "@/stores/overview-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useActiveWorkspace } from "@/stores/workspace-store";
import type { AgentOverview, ConfigAgent, Workspace } from "@/types";

const DEFAULT_OPEN: SectionKey[] = ["memory", "mcp"];

type SectionsProps = {
  workspace: Workspace;
  agent: ConfigAgent;
  overview: AgentOverview;
  query: string;
  reload: () => void;
};

const Sections = memo(({ workspace, agent, overview, query, reload }: SectionsProps) => {
  const [open, toggle] = useToggleSet<SectionKey>(DEFAULT_OPEN);
  const data = useMemo(() => filterOverview(overview, query), [overview, query]);
  const profile = PROFILES[agent];

  return (
    <>
      {profile.sections.map((key) => {
        const { title, icon, count, Body } = SECTIONS[key];
        return (
          <CollapsibleSection
            key={key}
            title={profile.titles[key] ?? title}
            icon={icon}
            count={count(data)}
            open={!!query || open.has(key)}
            onToggle={() => toggle(key)}
          >
            <Body
              workspace={workspace}
              agent={agent}
              profile={profile}
              data={data}
              reload={reload}
            />
          </CollapsibleSection>
        );
      })}
    </>
  );
});
Sections.displayName = "Sections";

const useDistroStopped = (cwd: string, error: string | null) => {
  const distro = parseWslPath(cwd)?.distro ?? null;
  const running = useSessionsStore((s) =>
    distro
      ? s.distros.find((d) => d.name.toLowerCase() === distro.toLowerCase())?.running
      : undefined,
  );
  if (!distro) return null;
  return running === false || (running === undefined && !!error?.includes("is stopped"))
    ? distro
    : null;
};

type WorkspaceConfigProps = {
  workspace: Workspace;
  agent: ConfigAgent;
};

const WorkspaceConfig = ({ workspace, agent }: WorkspaceConfigProps) => {
  const { overview, error, loading, reload } = useOverview(workspace.cwd, agent);
  const stoppedDistro = useDistroStopped(workspace.cwd, error);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const name = PROFILES[agent].name;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={basename(workspace.cwd)}>
        <IconButton label="Refresh" onClick={() => void reload()}>
          <RefreshCw className={cn(loading && "animate-spin")} />
        </IconButton>
      </PanelHeader>
      <div className="px-2 pb-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Filter memory, servers, skills…"
          aria-label={`Filter ${name} config`}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {stoppedDistro ? (
          <Alert
            tone="info"
            className="mx-2"
            action={<StartDistroButton distro={stoppedDistro} onStarted={() => void reload()} />}
          >
            WSL {stoppedDistro} is stopped. Start it to see the {name} config inside it.
          </Alert>
        ) : (
          <>
            {error && (
              <Alert tone="danger" className="mx-2 mb-2">
                {error}
              </Alert>
            )}
            {overview ? (
              <Sections
                workspace={workspace}
                agent={agent}
                overview={overview}
                query={deferredQuery}
                reload={reload}
              />
            ) : (
              !error && <LoadingState className="py-8" />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export const AgentConfigPanel = () => {
  const workspace = useActiveWorkspace();
  if (!workspace)
    return (
      <EmptyState
        className="h-full"
        icon={<BrainCircuit />}
        title="No session open"
        description="Open a session to see the memory, MCP servers, skills and settings its agent uses there."
      />
    );
  const agent = getAgent(workspace.agent)?.config ?? null;
  if (!agent)
    return (
      <EmptyState
        className="h-full"
        icon={<BrainCircuit />}
        title={`No config view for ${agentName(workspace.agent)}`}
        description="Deck can show memory, MCP servers and skills for Claude and Codex sessions."
      />
    );
  return <WorkspaceConfig key={`${workspace.id}:${agent}`} workspace={workspace} agent={agent} />;
};
