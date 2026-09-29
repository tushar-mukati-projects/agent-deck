import { useDeferredValue, useMemo, useState } from "react";
import { BrainCircuit, RefreshCw } from "lucide-react";

import { EmptyState, LoadingState } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Alert, CollapsibleSection, PanelHeader, SearchInput } from "@/components/ui/panel";
import { filterOverview } from "@/features/claude/filter-overview";
import { useOverview } from "@/features/claude/overview-store";
import { SECTIONS, type SectionKey } from "@/features/claude/sections";
import { StartDistroButton } from "@/features/sidebar/WslStatus";
import { basename, cn } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";
import { useSessionsStore } from "@/stores/sessions-store";
import { useActiveWorkspace } from "@/stores/workspace-store";
import type { ClaudeOverview, Workspace } from "@/types";

const DEFAULT_OPEN: SectionKey[] = ["memory", "mcp"];

const Sections = ({
  workspace,
  overview,
  query,
  reload,
}: {
  workspace: Workspace;
  overview: ClaudeOverview;
  query: string;
  reload: () => void;
}) => {
  const [open, setOpen] = useState<Set<SectionKey>>(() => new Set(DEFAULT_OPEN));
  const data = useMemo(() => filterOverview(overview, query), [overview, query]);
  const toggle = (key: SectionKey) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <>
      {SECTIONS.map(({ key, title, icon, count, Body }) => (
        <CollapsibleSection
          key={key}
          title={title}
          icon={icon}
          count={count(data)}
          open={!!query || open.has(key)}
          onToggle={() => toggle(key)}
        >
          <Body workspace={workspace} data={data} reload={reload} />
        </CollapsibleSection>
      ))}
    </>
  );
};

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

const WorkspaceConfig = ({ workspace }: { workspace: Workspace }) => {
  const { overview, error, loading, reload } = useOverview(workspace.cwd);
  const stoppedDistro = useDistroStopped(workspace.cwd, error);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

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
          aria-label="Filter Claude config"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {stoppedDistro ? (
          <Alert
            tone="info"
            className="mx-2"
            action={<StartDistroButton distro={stoppedDistro} onStarted={() => void reload()} />}
          >
            WSL {stoppedDistro} is stopped. Start it to see the Claude config inside it.
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
                overview={overview}
                query={deferredQuery}
                reload={() => void reload()}
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

export const ClaudePanel = () => {
  const workspace = useActiveWorkspace();
  if (!workspace)
    return (
      <EmptyState
        className="h-full"
        icon={<BrainCircuit />}
        title="No session open"
        description="Open a session to see the memory, MCP servers, skills and agents Claude uses there."
      />
    );
  return <WorkspaceConfig key={workspace.id} workspace={workspace} />;
};
