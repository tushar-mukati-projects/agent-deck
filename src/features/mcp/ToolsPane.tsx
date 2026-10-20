import { useCallback, useEffect, useState } from "react";
import { FileText, Power, Wrench } from "lucide-react";

import { ErrorAlert } from "@/components/ui/error-alert";
import { EmptyState, LoadingState, showError, Spinner } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { ListRow } from "@/components/ui/list-row";
import { Alert, SearchInput, SectionLabel } from "@/components/ui/panel";
import { TextResult } from "@/features/mcp/CallResult";
import { ToolRunner } from "@/features/mcp/ToolRunner";
import { useAsync } from "@/hooks/useAsync";
import { matches } from "@/lib/agent-config/filter-overview";
import { resourceTexts } from "@/lib/mcp/results";
import { api } from "@/lib/tauri/commands";
import { errorMessage } from "@/lib/utils";
import type { McpDescription, McpServer } from "@/types";

type Selection = { kind: "tool" | "resource"; name: string };

const firstSelection = (description: McpDescription): Selection | null => {
  if (description.tools[0]) return { kind: "tool", name: description.tools[0].name };
  if (description.resources[0]) return { kind: "resource", name: description.resources[0].uri };
  return null;
};

const ResourceView = ({ cwd, serverId, uri }: { cwd: string; serverId: string; uri: string }) => {
  const { data, error } = useAsync(
    () => api.mcpReadResource(cwd, serverId, uri),
    [cwd, serverId, uri],
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <p className="mb-2 font-mono text-[12px] break-all text-muted">{uri}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      {data === undefined && !error && <Spinner />}
      {data !== undefined &&
        resourceTexts(data).map((text, index) => <TextResult key={index} text={text} />)}
    </div>
  );
};

const useDescription = (cwd: string, serverId: string) => {
  const [description, setDescription] = useState<McpDescription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      setDescription(await api.mcpDescribe(cwd, serverId));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setConnecting(false);
    }
  }, [cwd, serverId]);

  useEffect(() => {
    void connect();
  }, [connect]);

  const restart = async () => {
    await api.mcpDisconnect(cwd, serverId).catch(showError);
    setDescription(null);
    await connect();
  };

  return { description, error, connecting, connect, restart };
};

export const ToolsPane = ({ cwd, server }: { cwd: string; server: McpServer }) => {
  const { description, error, connecting, connect, restart } = useDescription(cwd, server.id);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Selection | null>(null);

  if (connecting && !description)
    return (
      <LoadingState
        className="flex-1"
        label={server.transport === "stdio" ? "Starting the server…" : "Connecting…"}
      />
    );
  if (!description)
    return (
      <div className="p-4">
        <ErrorAlert
          message={error ?? "Couldn't connect to the server."}
          onRetry={() => void connect()}
        />
      </div>
    );

  const selected = picked ?? firstSelection(description);
  const needle = filter.trim().toLowerCase();
  const tools = description.tools.filter((t) => matches(needle, t.name, t.description));
  const resources = description.resources.filter((r) =>
    matches(needle, r.name, r.uri, r.description),
  );
  const tool =
    selected?.kind === "tool" ? description.tools.find((t) => t.name === selected.name) : undefined;
  const isSelected = (kind: Selection["kind"], name: string) =>
    selected?.kind === kind && selected.name === name;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[260px] shrink-0 flex-col border-r border-border bg-panel">
        <div className="flex items-center gap-1 p-2">
          <SearchInput
            value={filter}
            onChange={setFilter}
            placeholder="Filter tools…"
            aria-label="Filter tools"
            className="flex-1"
          />
          <IconButton label="Restart server" disabled={connecting} onClick={() => void restart()}>
            <Power />
          </IconButton>
        </div>
        {description.serverInfo?.name && (
          <p className="truncate px-3 pb-1 text-[10.5px] text-faint">
            {description.serverInfo.title ?? description.serverInfo.name}
            {description.serverInfo.version && ` · v${description.serverInfo.version}`}
          </p>
        )}
        {error && (
          <Alert tone="danger" className="mx-2 mb-1 text-[11px]">
            {error}
          </Alert>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          <SectionLabel className="px-2 pt-1 pb-0.5">
            Tools · {description.tools.length}
          </SectionLabel>
          {tools.map((t) => (
            <ListRow
              key={t.name}
              icon={<Wrench />}
              title={t.name}
              subtitle={t.description}
              mono
              selected={isSelected("tool", t.name)}
              onClick={() => setPicked({ kind: "tool", name: t.name })}
            />
          ))}
          {description.resources.length > 0 && (
            <>
              <SectionLabel className="px-2 pt-3 pb-0.5">
                Resources · {description.resources.length}
              </SectionLabel>
              {resources.map((r) => (
                <ListRow
                  key={r.uri}
                  icon={<FileText />}
                  title={r.name ?? r.uri}
                  subtitle={r.description}
                  selected={isSelected("resource", r.uri)}
                  onClick={() => setPicked({ kind: "resource", name: r.uri })}
                />
              ))}
            </>
          )}
          {description.prompts.length > 0 && (
            <p className="px-2 pt-3 text-[10.5px] break-words text-faint">
              {description.prompts.length} prompts:{" "}
              {description.prompts.map((p) => p.name).join(", ")}
            </p>
          )}
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        {tool ? (
          <ToolRunner key={tool.name} cwd={cwd} serverId={server.id} tool={tool} />
        ) : selected?.kind === "resource" ? (
          <ResourceView key={selected.name} cwd={cwd} serverId={server.id} uri={selected.name} />
        ) : (
          <EmptyState
            className="h-full"
            icon={<Wrench />}
            title="Nothing to run"
            description="This server doesn't expose any tools or resources."
          />
        )}
      </div>
    </div>
  );
};
