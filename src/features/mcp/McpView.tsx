import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Database, FileText, Play, Plug, Power, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Alert, ScopeBadge, SearchInput, Segmented } from "@/components/ui/panel";
import { PgBrowser } from "@/features/mcp/PgBrowser";
import { gridFromObjects, ResultGrid } from "@/features/mcp/ResultGrid";
import { MarkdownView } from "@/features/viewer/MarkdownView";
import { api } from "@/lib/tauri/commands";
import { cn, errorMessage } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { JsonSchema, McpDescription, McpServer, McpTool, Workspace } from "@/types";

const CodeView = lazy(() =>
  import("@/features/viewer/CodeView").then((m) => ({ default: m.CodeView })),
);

type Mode = "database" | "tools";

const exampleValue = (schema: JsonSchema): unknown => {
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "number" || type === "integer") return 0;
  if (type === "boolean") return false;
  if (type === "array") return [];
  if (type === "object") return {};
  return "";
};

export const exampleArguments = (schema?: JsonSchema) => {
  const required = new Set(schema?.required ?? []);
  const entries = Object.entries(schema?.properties ?? {}).filter(([name]) => required.has(name));
  return JSON.stringify(Object.fromEntries(entries.map(([n, s]) => [n, exampleValue(s)])), null, 2);
};

const useServer = (cwd: string, serverId: string) => {
  const [server, setServer] = useState<McpServer | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    api
      .claudeOverview(cwd)
      .then((o) => !cancelled && setServer(o.mcp.find((s) => s.id === serverId) ?? null))
      .catch(() => !cancelled && setServer(null));
    return () => {
      cancelled = true;
    };
  }, [cwd, serverId]);
  return server;
};

interface ContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri?: string; text?: string };
}

const TextResult = ({ text }: { text: string }) => {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }, [text]);
  const grid = parsed !== undefined ? gridFromObjects(parsed) : null;
  if (grid) return <ResultGrid className="max-h-[520px]" columns={grid.columns} rows={grid.rows} />;
  return (
    <pre className="max-h-[520px] overflow-auto rounded-md border border-border bg-code-bg p-3 font-mono text-[11.5px] whitespace-pre-wrap text-fg/90 select-text">
      {parsed !== undefined ? JSON.stringify(parsed, null, 2) : text}
    </pre>
  );
};

const CallResult = ({ result }: { result: unknown }) => {
  const value = (result ?? {}) as {
    content?: ContentItem[];
    isError?: boolean;
    structuredContent?: unknown;
  };
  const content = value.content ?? [];
  return (
    <div className="flex flex-col gap-2">
      {value.isError && <Alert tone="danger">The tool reported an error.</Alert>}
      {content.length === 0 && (
        <TextResult text={JSON.stringify(value.structuredContent ?? result ?? null)} />
      )}
      {content.map((item, index) => {
        if (item.type === "text" && item.text !== undefined)
          return <TextResult key={index} text={item.text} />;
        if (item.type === "image" && item.data)
          return (
            <img
              key={index}
              alt=""
              src={`data:${item.mimeType ?? "image/png"};base64,${item.data}`}
              className="max-h-[480px] max-w-full self-start rounded-md border border-border"
            />
          );
        if (item.type === "resource" && item.resource?.text !== undefined)
          return <TextResult key={index} text={item.resource.text} />;
        return <TextResult key={index} text={JSON.stringify(item, null, 2)} />;
      })}
    </div>
  );
};

const Parameters = ({ schema }: { schema?: JsonSchema }) => {
  const properties = Object.entries(schema?.properties ?? {});
  if (!properties.length)
    return <p className="text-[11.5px] text-faint">This tool takes no arguments.</p>;
  const required = new Set(schema?.required ?? []);
  return (
    <div className="flex flex-col gap-1">
      {properties.map(([name, prop]) => (
        <div key={name} className="text-[11.5px]">
          <span className="font-mono text-fg/90">{name}</span>
          <span className="ml-1.5 font-mono text-faint">
            {Array.isArray(prop.type) ? prop.type.join(" | ") : (prop.type ?? "any")}
            {required.has(name) ? "" : "?"}
          </span>
          {prop.enum && (
            <span className="ml-1.5 text-faint">one of {prop.enum.map(String).join(", ")}</span>
          )}
          {prop.description && <p className="text-faint">{prop.description}</p>}
        </div>
      ))}
    </div>
  );
};

const ToolRunner = ({ cwd, serverId, tool }: { cwd: string; serverId: string; tool: McpTool }) => {
  const [args, setArgs] = useState(() => exampleArguments(tool.inputSchema));
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const argsRef = useRef(args);
  argsRef.current = args;

  const run = useCallback(async () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsRef.current || "{}");
    } catch (e) {
      setError(`Arguments aren't valid JSON: ${errorMessage(e)}`);
      return;
    }
    if (tool.annotations?.destructiveHint) {
      const ok = await useUiStore.getState().askConfirm({
        title: `Run ${tool.name}?`,
        description: "The server marks this tool as destructive. It may change or delete data.",
        confirmLabel: "Run tool",
        destructive: true,
      });
      if (!ok) return;
    }
    setRunning(true);
    const started = performance.now();
    try {
      setResult(await api.mcpCall(cwd, serverId, tool.name, parsed));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
      setResult(undefined);
    } finally {
      setElapsed(Math.round(performance.now() - started));
      setRunning(false);
    }
  }, [cwd, serverId, tool]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <div className="flex items-center gap-2">
        <Wrench className="size-4 text-faint" />
        <h2 className="font-mono text-[13.5px] font-semibold text-fg">{tool.name}</h2>
        {tool.annotations?.readOnlyHint && <ScopeBadge>read-only</ScopeBadge>}
        {tool.annotations?.destructiveHint && <ScopeBadge>destructive</ScopeBadge>}
      </div>
      {tool.description && (
        <div className="mt-2 max-h-[200px] overflow-y-auto">
          <MarkdownView source={tool.description} compact />
        </div>
      )}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
        <div className="h-[180px] overflow-hidden rounded-md border border-border bg-code-bg">
          <Suspense fallback={<Spinner className="m-3" />}>
            <CodeView
              path="arguments.json"
              value={args}
              editable
              onChange={setArgs}
              onSave={() => void run()}
            />
          </Suspense>
        </div>
        <div className="max-h-[180px] overflow-y-auto">
          <Parameters schema={tool.inputSchema} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={running} onClick={() => void run()}>
          <Play className="fill-current" /> Run tool
        </Button>
        <span className="flex items-center gap-1 text-[11px] text-faint">
          <Kbd keys="Ctrl S" /> in the editor also runs it
        </span>
        {running && <Spinner className="size-3.5" />}
        {elapsed !== null && !running && (
          <span className="ml-auto text-[11px] text-faint tabular-nums">{elapsed} ms</span>
        )}
      </div>
      <div className="mt-3">
        {error && (
          <Alert tone="danger">
            <span className="whitespace-pre-wrap">{error}</span>
          </Alert>
        )}
        {result !== undefined && <CallResult result={result} />}
      </div>
    </div>
  );
};

const ResourceView = ({ cwd, serverId, uri }: { cwd: string; serverId: string; uri: string }) => {
  const [value, setValue] = useState<unknown>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setValue(undefined);
    api
      .mcpReadResource(cwd, serverId, uri)
      .then((v) => !cancelled && setValue(v))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [cwd, serverId, uri]);
  const contents = ((value ?? {}) as { contents?: { text?: string }[] }).contents ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <p className="mb-2 font-mono text-[12px] text-muted">{uri}</p>
      {error && <Alert tone="danger">{error}</Alert>}
      {value === undefined && !error && <Spinner />}
      {contents.map((c, i) => (
        <TextResult key={i} text={c.text ?? JSON.stringify(c, null, 2)} />
      ))}
    </div>
  );
};

const ToolsPane = ({ cwd, server }: { cwd: string; server: McpServer }) => {
  const [description, setDescription] = useState<McpDescription | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<{ kind: "tool" | "resource"; name: string } | null>(
    null,
  );

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const result = await api.mcpDescribe(cwd, server.id);
      setDescription(result);
      setSelected(
        (current) =>
          current ?? (result.tools[0] ? { kind: "tool", name: result.tools[0].name } : null),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setConnecting(false);
    }
  }, [cwd, server.id]);

  useEffect(() => {
    void connect();
  }, [connect]);

  const restart = async () => {
    await api.mcpDisconnect(cwd, server.id).catch(() => undefined);
    setDescription(null);
    void connect();
  };

  if (connecting && !description)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[12px] text-faint">
        <Spinner />
        {server.transport === "stdio" ? "Starting the server…" : "Connecting…"}
      </div>
    );
  if (error && !description)
    return (
      <div className="p-4">
        <Alert
          tone="danger"
          action={
            <Button size="sm" variant="ghost" onClick={() => void connect()}>
              Retry
            </Button>
          }
        >
          <span className="whitespace-pre-wrap">{error}</span>
        </Alert>
      </div>
    );
  if (!description) return null;

  const needle = filter.trim().toLowerCase();
  const tools = description.tools.filter(
    (t) =>
      !needle ||
      t.name.toLowerCase().includes(needle) ||
      t.description?.toLowerCase().includes(needle),
  );
  const tool =
    selected?.kind === "tool" ? description.tools.find((t) => t.name === selected.name) : undefined;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[260px] shrink-0 flex-col border-r border-border bg-panel">
        <div className="flex items-center gap-1 p-2">
          <SearchInput
            value={filter}
            onChange={setFilter}
            placeholder="Filter tools…"
            className="flex-1"
          />
          <IconButton label="Restart server" onClick={() => void restart()}>
            <Power />
          </IconButton>
        </div>
        {description.serverInfo?.name && (
          <p className="truncate px-3 pb-1 text-[10.5px] text-faint">
            {description.serverInfo.title ?? description.serverInfo.name}
            {description.serverInfo.version && ` · v${description.serverInfo.version}`}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
          <p className="px-2 pt-1 pb-0.5 text-[10.5px] font-semibold tracking-wide text-faint uppercase">
            Tools · {description.tools.length}
          </p>
          {tools.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => setSelected({ kind: "tool", name: t.name })}
              title={t.description}
              className={cn(
                "flex w-full flex-col rounded px-2 py-1 text-left",
                selected?.kind === "tool" && selected.name === t.name
                  ? "bg-active"
                  : "hover:bg-hover",
              )}
            >
              <span className="truncate font-mono text-[11.5px] text-fg/90">{t.name}</span>
              {t.description && (
                <span className="line-clamp-1 text-[10.5px] text-faint">{t.description}</span>
              )}
            </button>
          ))}
          {description.resources.length > 0 && (
            <>
              <p className="px-2 pt-3 pb-0.5 text-[10.5px] font-semibold tracking-wide text-faint uppercase">
                Resources · {description.resources.length}
              </p>
              {description.resources.map((r) => (
                <button
                  key={r.uri}
                  type="button"
                  onClick={() => setSelected({ kind: "resource", name: r.uri })}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left",
                    selected?.kind === "resource" && selected.name === r.uri
                      ? "bg-active"
                      : "hover:bg-hover",
                  )}
                >
                  <FileText className="size-3 shrink-0 text-faint" />
                  <span className="truncate text-[11.5px] text-fg/90">{r.name ?? r.uri}</span>
                </button>
              ))}
            </>
          )}
          {description.prompts.length > 0 && (
            <p className="px-2 pt-3 text-[10.5px] text-faint">
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
            title="No tools"
            description="This server doesn't expose any tools."
          />
        )}
      </div>
    </div>
  );
};

export const McpView = ({ workspace, serverId }: { workspace: Workspace; serverId: string }) => {
  const server = useServer(workspace.cwd, serverId);
  const [mode, setMode] = useState<Mode>("database");

  if (server === undefined)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    );
  if (server === null)
    return (
      <EmptyState
        className="h-full"
        icon={<Plug />}
        title="Server not found"
        description={`${serverId} isn't configured for this folder any more.`}
      />
    );

  const detail = server.url ?? [server.command, ...server.args].filter(Boolean).join(" ");
  const showDatabase = server.postgres && mode === "database";

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
            onChange={setMode}
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
          This server is disabled for this project in Claude Code. You can still inspect it here.
        </Alert>
      )}
      {showDatabase ? (
        <PgBrowser cwd={workspace.cwd} serverId={server.id} />
      ) : (
        <ToolsPane cwd={workspace.cwd} server={server} />
      )}
    </div>
  );
};
