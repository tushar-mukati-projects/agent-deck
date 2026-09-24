import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  Blocks,
  BookOpen,
  BrainCircuit,
  Database,
  FilePlus2,
  FileText,
  Plug,
  Power,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareSlash,
  Terminal,
  Webhook,
} from "lucide-react";
import { toast } from "sonner";

import { sendToClaude } from "@/actions/claude";
import { startAgentSession } from "@/actions/sessions";
import { Button } from "@/components/ui/button";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import {
  Alert,
  CollapsibleSection,
  PanelHeader,
  ScopeBadge,
  SearchInput,
} from "@/components/ui/panel";
import { encodeMcpTab } from "@/lib/diff-tabs";
import { api } from "@/lib/tauri/commands";
import { revealInExplorer } from "@/lib/tauri/system";
import { appWindow } from "@/lib/tauri/system";
import { basename, cn, errorMessage, timeAgo } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";
import { useSessionsStore } from "@/stores/sessions-store";
import { useViewerStore } from "@/stores/viewer-store";
import { useActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { ClaudeOverview, ConfigItem, ConfigScope, McpServer, Workspace } from "@/types";

type SectionKey =
  | "memory"
  | "mcp"
  | "skills"
  | "agents"
  | "commands"
  | "hooks"
  | "permissions"
  | "plugins"
  | "settings";

const DEFAULT_OPEN: SectionKey[] = ["memory", "mcp"];

const scopeLabel = (scope: ConfigScope, plugin?: string | null) =>
  plugin ?? (scope === "auto" ? "auto memory" : scope);

const useOverview = (cwd: string | null) => {
  const [overview, setOverview] = useState<ClaudeOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    if (!cwd) return;
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const result = await api.claudeOverview(cwd);
      if (request === requestRef.current) {
        setOverview(result);
        setError(null);
      }
    } catch (e) {
      if (request === requestRef.current) setError(errorMessage(e));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    setOverview(null);
    void load();
  }, [load]);

  useEffect(() => {
    const unlisten = appWindow.onFocusChanged(({ payload }) => payload && void load());
    return () => void unlisten.then((fn) => fn());
  }, [load]);

  return { overview, error, loading, reload: load };
};

const matches = (query: string, ...fields: (string | null | undefined)[]) =>
  !query || fields.some((f) => f?.toLowerCase().includes(query));

const Row = ({
  icon,
  title,
  subtitle,
  badge,
  meta,
  onClick,
  actions,
  dim,
  mono,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string | null;
  badge?: React.ReactNode;
  meta?: React.ReactNode;
  onClick: () => void;
  actions?: React.ReactNode;
  dim?: boolean;
  mono?: boolean;
}) => (
  <div
    className={cn(
      "group flex items-start gap-2 rounded-md px-2 py-1 hover:bg-hover",
      dim && "opacity-55",
    )}
  >
    <span className="mt-[3px] flex shrink-0 text-faint [&_svg]:size-3.5">{icon}</span>
    <button
      type="button"
      onClick={onClick}
      title={subtitle ?? title}
      className="min-w-0 flex-1 text-left"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn("truncate text-[12px] text-fg/90", mono && "font-mono text-[11.5px]")}>
          {title}
        </span>
        {badge}
        {meta && (
          <span className="ml-auto shrink-0 text-[10.5px] text-faint tabular-nums">{meta}</span>
        )}
      </div>
      {subtitle && <p className="line-clamp-2 text-[10.5px] leading-snug text-faint">{subtitle}</p>}
    </button>
    {actions && (
      <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        {actions}
      </div>
    )}
  </div>
);

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="px-2 py-1 text-[11.5px] text-faint">{children}</p>
);

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

const invocation = (item: ConfigItem) =>
  item.plugin && !item.name.startsWith(`${item.plugin}:`)
    ? `${item.plugin}:${item.name}`
    : item.name;

const serverDetail = (server: McpServer) =>
  server.url ?? [server.command, ...server.args].filter(Boolean).join(" ");

const ItemRows = ({
  items,
  icon,
  workspace,
  slash,
  agents,
}: {
  items: ConfigItem[];
  icon: React.ReactNode;
  workspace: Workspace;
  slash?: boolean;
  agents?: boolean;
}) => (
  <>
    {items.map((item) => (
      <Row
        key={item.path}
        icon={icon}
        title={slash ? `/${invocation(item)}` : item.name}
        mono={slash}
        subtitle={item.description}
        badge={<ScopeBadge>{scopeLabel(item.scope, item.plugin)}</ScopeBadge>}
        onClick={() => openFile(workspace, item.path)}
        actions={
          agents ? (
            <IconButton
              label={`New session with ${item.name}`}
              onClick={() => startAgentSession(workspace.cwd, item.name)}
            >
              <Sparkles />
            </IconButton>
          ) : (
            <IconButton
              label={`Type /${invocation(item)} in Claude`}
              onClick={() => sendToClaude(workspace, `/${invocation(item)} `)}
            >
              <Terminal />
            </IconButton>
          )
        }
      />
    ))}
  </>
);

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
  const isOpen = (key: SectionKey) => !!query || open.has(key);
  const toggle = (key: SectionKey) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const filtered = useMemo(() => {
    const items = (list: ConfigItem[]) =>
      list.filter((i) => matches(query, i.name, i.description, i.plugin));
    const permissions = overview.settings.flatMap((file) =>
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
      modes: overview.settings.filter((s) => s.defaultMode || s.model),
      plugins: overview.plugins.filter((p) => matches(query, p.name)),
      settings: overview.settings.filter((s) => matches(query, s.label, s.path)),
    };
  }, [overview, query]);

  const section = (key: SectionKey, title: string, icon: React.ReactNode, count: number) => ({
    title,
    icon,
    count,
    open: isOpen(key),
    onToggle: () => toggle(key),
  });

  const memoryCount = filtered.memory.filter((m) => m.exists).length;

  return (
    <>
      <CollapsibleSection {...section("memory", "Memory", <BrainCircuit />, memoryCount)}>
        {filtered.memory.map((file) =>
          file.exists ? (
            <Row
              key={file.path}
              icon={<FileText />}
              title={file.label}
              subtitle={file.description}
              badge={<ScopeBadge>{scopeLabel(file.scope)}</ScopeBadge>}
              meta={timeAgo(file.modifiedMs)}
              onClick={() => openFile(workspace, file.path)}
            />
          ) : (
            <Row
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
      </CollapsibleSection>

      <CollapsibleSection {...section("mcp", "MCP servers", <Plug />, filtered.mcp.length)}>
        {filtered.mcp.length === 0 && <Hint>No MCP servers configured for this folder.</Hint>}
        {filtered.mcp.map((server) => (
          <Row
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
      </CollapsibleSection>

      <CollapsibleSection {...section("skills", "Skills", <BookOpen />, filtered.skills.length)}>
        {filtered.skills.length === 0 && <Hint>No skills found.</Hint>}
        <ItemRows items={filtered.skills} icon={<BookOpen />} workspace={workspace} slash />
      </CollapsibleSection>

      <CollapsibleSection {...section("agents", "Agents", <Sparkles />, filtered.agents.length)}>
        {filtered.agents.length === 0 && (
          <Hint>No agents in ~/.claude/agents or .claude/agents.</Hint>
        )}
        <ItemRows items={filtered.agents} icon={<Sparkles />} workspace={workspace} agents />
      </CollapsibleSection>

      <CollapsibleSection
        {...section("commands", "Slash commands", <SquareSlash />, filtered.commands.length)}
      >
        {filtered.commands.length === 0 && <Hint>No custom slash commands.</Hint>}
        <ItemRows items={filtered.commands} icon={<SquareSlash />} workspace={workspace} slash />
      </CollapsibleSection>

      <CollapsibleSection {...section("hooks", "Hooks", <Webhook />, filtered.hooks.length)}>
        {filtered.hooks.length === 0 && <Hint>No hooks configured.</Hint>}
        {filtered.hooks.map((hook, index) => (
          <Row
            key={`${hook.source}:${index}`}
            icon={<Webhook />}
            title={hook.matcher ? `${hook.event} · ${hook.matcher}` : hook.event}
            subtitle={hook.command}
            badge={<ScopeBadge>{scopeLabel(hook.scope, hook.plugin)}</ScopeBadge>}
            onClick={() => openFile(workspace, hook.source)}
          />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        {...section("permissions", "Permissions", <ShieldCheck />, filtered.permissions.length)}
      >
        {filtered.modes.map((file) => (
          <Row
            key={`mode:${file.path}`}
            icon={<Settings2 />}
            title={[
              file.defaultMode && `Mode: ${file.defaultMode}`,
              file.model && `Model: ${file.model}`,
            ]
              .filter(Boolean)
              .join(" · ")}
            badge={<ScopeBadge>{scopeLabel(file.scope)}</ScopeBadge>}
            onClick={() => openFile(workspace, file.path)}
          />
        ))}
        {filtered.permissions.length === 0 && <Hint>No allow, ask or deny rules.</Hint>}
        {filtered.permissions.map(({ kind, rule, file }, index) => (
          <Row
            key={`${file.path}:${kind}:${index}`}
            icon={
              <ShieldCheck
                className={cn(
                  kind === "allow" && "text-success",
                  kind === "deny" && "text-danger",
                  kind === "ask" && "text-warning",
                )}
              />
            }
            title={rule}
            mono
            badge={<ScopeBadge>{kind}</ScopeBadge>}
            meta={scopeLabel(file.scope)}
            onClick={() => openFile(workspace, file.path)}
          />
        ))}
      </CollapsibleSection>

      <CollapsibleSection {...section("plugins", "Plugins", <Blocks />, filtered.plugins.length)}>
        {filtered.plugins.length === 0 && <Hint>No plugins installed.</Hint>}
        {filtered.plugins.map((plugin) => (
          <Row
            key={plugin.name}
            icon={<Blocks />}
            title={plugin.name.split("@")[0]}
            subtitle={plugin.name.includes("@") ? `from ${plugin.name.split("@")[1]}` : null}
            badge={<ScopeBadge>{plugin.scope}</ScopeBadge>}
            meta={plugin.enabled ? plugin.version : "disabled"}
            dim={!plugin.enabled}
            onClick={() => void revealInExplorer(plugin.path)}
          />
        ))}
      </CollapsibleSection>

      <CollapsibleSection
        {...section(
          "settings",
          "Settings files",
          <Settings2 />,
          filtered.settings.filter((s) => s.exists).length,
        )}
      >
        {filtered.settings.map((file) => (
          <Row
            key={file.path}
            icon={<Settings2 />}
            title={file.label}
            subtitle={file.exists ? file.path : "Not created yet"}
            badge={<ScopeBadge>{scopeLabel(file.scope)}</ScopeBadge>}
            dim={!file.exists}
            onClick={() => file.exists && openFile(workspace, file.path)}
          />
        ))}
      </CollapsibleSection>
    </>
  );
};

export const ClaudePanel = () => {
  const workspace = useActiveWorkspace();
  const wsl = workspace ? parseWslPath(workspace.cwd) : null;
  const { overview, error, loading, reload } = useOverview(workspace?.cwd ?? null);
  const [starting, setStarting] = useState(false);
  const stopped = !!wsl && !!error?.includes("is stopped");

  const startDistro = async () => {
    if (!wsl) return;
    setStarting(true);
    try {
      await useSessionsStore.getState().startDistro(wsl.distro);
      await reload();
    } finally {
      setStarting(false);
    }
  };
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  if (!workspace) {
    return (
      <EmptyState
        className="h-full"
        icon={<BrainCircuit />}
        title="No session open"
        description="Open a session to see the memory, MCP servers, skills and agents Claude uses there."
      />
    );
  }

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
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {stopped ? (
          <Alert
            tone="info"
            className="mx-2"
            action={
              <Button
                size="sm"
                variant="ghost"
                disabled={starting}
                onClick={() => void startDistro()}
              >
                <Power /> {starting ? "Starting…" : "Start"}
              </Button>
            }
          >
            WSL {wsl?.distro} is stopped. Start it to see the Claude config inside it.
          </Alert>
        ) : error ? (
          <Alert tone="danger" className="mx-2">
            {error}
          </Alert>
        ) : !overview ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <Sections
            workspace={workspace}
            overview={overview}
            query={deferredQuery}
            reload={() => void reload()}
          />
        )}
      </div>
    </div>
  );
};
