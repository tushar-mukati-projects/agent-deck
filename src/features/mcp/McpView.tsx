import { useState } from "react";
import { Database, FileText, Plug, Wrench } from "lucide-react";

import { ErrorAlert } from "@/components/ui/error-alert";
import { EmptyState, LoadingState } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Alert, ScopeBadge, Segmented } from "@/components/ui/panel";
import { serverDetail } from "@/features/agent-config/filter-overview";
import { useOverview } from "@/features/agent-config/overview-store";
import { PROFILES, serverAgent } from "@/features/agent-config/profiles";
import { PgBrowser } from "@/features/mcp/PgBrowser";
import { ToolsPane } from "@/features/mcp/ToolsPane";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { McpServer, Workspace } from "@/types";

type Mode = "database" | "tools";

const ServerView = ({
  workspace,
  server,
  agentName,
}: {
  workspace: Workspace;
  server: McpServer;
  agentName: string;
}) => {
  const [mode, setMode] = useState<Mode>("database");
  const [toolsOpened, setToolsOpened] = useState(!server.postgres);
  const detail = serverDetail(server);
  const showTools = !server.postgres || mode === "tools";
  const pickMode = (next: Mode) => {
    setMode(next);
    if (next === "tools") setToolsOpened(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        {server.postgres ? (
          <Database className="size-3.5 text-info" />
        ) : (
          <Plug className="size-3.5 text-faint" />
        )}
        <span className="text-[12.5px] font-semibold text-fg">{server.name}</span>
        <ScopeBadge>{server.plugin ?? server.scope}</ScopeBadge>
        <ScopeBadge>{server.transport}</ScopeBadge>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint" title={detail}>
          {detail}
        </span>
        {server.postgres && (
          <Segmented<Mode>
            size="sm"
            value={mode}
            onChange={pickMode}
            options={[
              { value: "database", label: "Database", icon: <Database /> },
              { value: "tools", label: "MCP tools", icon: <Wrench /> },
            ]}
          />
        )}
        <IconButton
          label="Open config file"
          onClick={() => useWorkspaceStore.getState().openFile(workspace.id, server.source)}
        >
          <FileText />
        </IconButton>
      </div>
      {server.disabled && (
        <Alert tone="warning" className="m-2 mb-0">
          This server is turned off in {agentName}&apos;s config. You can still inspect it here.
        </Alert>
      )}
      {server.postgres && (
        <div className={showTools ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
          <PgBrowser cwd={workspace.cwd} serverId={server.id} />
        </div>
      )}
      {toolsOpened && (
        <div className={showTools ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <ToolsPane cwd={workspace.cwd} server={server} />
        </div>
      )}
    </div>
  );
};

export const McpView = ({ workspace, serverId }: { workspace: Workspace; serverId: string }) => {
  const agent = serverAgent(serverId);
  const { overview, error, loading, reload } = useOverview(workspace.cwd, agent);
  const server = overview?.mcp.find((s) => s.id === serverId);

  if (server)
    return <ServerView workspace={workspace} server={server} agentName={PROFILES[agent].name} />;
  if (!overview)
    return error ? (
      <div className="p-4">
        <ErrorAlert message={error} retrying={loading} onRetry={() => void reload()} />
      </div>
    ) : (
      <LoadingState className="flex-1" />
    );
  return (
    <EmptyState
      className="h-full"
      icon={<Plug />}
      title="Server not found"
      description={`${serverId} isn't configured for this folder any more.`}
    />
  );
};
