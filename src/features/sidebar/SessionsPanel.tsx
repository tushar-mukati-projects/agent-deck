import { useDeferredValue, useMemo, useRef, useState } from "react";
import { Archive, FolderOpen, Pin, Plus, Power, RefreshCw, Sparkles } from "lucide-react";

import { startNewSession, startSessionInPickedFolder } from "@/actions/sessions";

import { Button } from "@/components/ui/button";
import { EmptyState, Spinner, type DotTone } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Chevron, PanelHeader, SearchInput, Segmented } from "@/components/ui/panel";
import { FolderFilter } from "@/features/sidebar/FolderFilter";
import { SessionItem } from "@/features/sidebar/SessionItem";
import { terminalTone } from "@/hooks/useWorkspaceStatus";
import { basename, cn, isWithin, normalizePath, samePath, shortenHome } from "@/lib/utils";
import { agentName } from "@/lib/agents/registry";
import { parseWslPath } from "@/lib/wsl";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { SessionInfo } from "@/types";

interface SessionGroup {
  cwd: string;
  sessions: SessionInfo[];
}

const matchesQuery = (session: SessionInfo, terms: string[]) => {
  const haystack = [
    session.title,
    session.firstPrompt,
    session.lastPrompt,
    session.cwd,
    session.gitBranch,
    session.id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
};

const groupByFolder = (sessions: SessionInfo[]) => {
  const groups = new Map<string, SessionGroup>();
  for (const session of sessions) {
    const key = normalizePath(session.cwd);
    const group = groups.get(key) ?? { cwd: session.cwd, sessions: [] };
    group.sessions.push(session);
    groups.set(key, group);
  }
  return [...groups.values()];
};

const useSessionTones = () => {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const terminals = useTerminalStore((s) => s.terminals);
  const live = useSessionsStore((s) => s.live);
  return useMemo(() => {
    const tones = new Map<string, DotTone>();
    const ownPids = new Set(Object.values(terminals).map((t) => t.pid));
    for (const entry of live) if (!ownPids.has(entry.pid)) tones.set(entry.sessionId, "external");
    for (const workspace of workspaces) {
      const tone = workspace.agentTerminalId
        ? terminalTone(terminals[workspace.agentTerminalId])
        : null;
      if (tone) tones.set(workspace.sessionId, tone);
    }
    return tones;
  }, [workspaces, terminals, live]);
};

const FolderHeader = ({
  group,
  collapsed,
  onToggle,
}: {
  group: SessionGroup;
  collapsed: boolean;
  onToggle: () => void;
}) => {
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const wsl = parseWslPath(group.cwd);
  return (
    <div className="group sticky top-0 z-10 flex h-8 items-center gap-1 bg-panel/95 pr-1 pl-1 backdrop-blur-sm">
      <button
        type="button"
        onClick={onToggle}
        title={group.cwd}
        data-session-row
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[12.5px] font-medium text-fg hover:text-fg"
      >
        <Chevron open={!collapsed} />
        <FolderOpen className="size-3.5 shrink-0 text-folder" />
        <span className="max-w-[70%] shrink-0 truncate">{basename(group.cwd)}</span>
        {wsl && (
          <span className="shrink-0 rounded border border-badge/30 bg-badge/10 px-1 text-[9px] leading-[14px] font-bold tracking-wider text-badge">
            WSL
          </span>
        )}
        <span className="min-w-0 truncate text-[11px] font-normal text-faint">
          {shortenHome(group.cwd, home)}
        </span>
      </button>
      <span className="text-[10.5px] text-faint tabular-nums group-focus-within:hidden group-hover:hidden">
        {group.sessions.length}
      </span>
      <IconButton
        label={`New session in ${basename(group.cwd)}`}
        className="hidden group-focus-within:inline-flex group-hover:inline-flex"
        onClick={() => startNewSession(group.cwd)}
      >
        <Plus />
      </IconButton>
    </div>
  );
};

const WslStatus = () => {
  const includeWsl = useSettingsStore((s) => s.includeWsl);
  const distros = useSessionsStore((s) => s.distros);
  const loading = useSessionsStore((s) => s.wslLoading);
  const errors = useSessionsStore((s) => s.wslErrors);
  const startDistro = useSessionsStore((s) => s.startDistro);
  if (!includeWsl) return null;
  const stopped = distros.filter((d) => !d.running);
  const errorList = Object.entries(errors);
  if (!loading && stopped.length === 0 && errorList.length === 0) return null;

  return (
    <div className="mx-2 mb-2 flex flex-col gap-1">
      {loading && (
        <div className="flex h-7 items-center gap-2 rounded-md border border-border bg-elevated px-2 text-[11px] text-muted">
          <Spinner className="size-3" /> Indexing WSL sessions…
        </div>
      )}
      {!loading &&
        stopped.map((distro) => (
          <div
            key={distro.name}
            className="flex h-7 items-center gap-2 rounded-md border border-border bg-elevated pr-1 pl-2 text-[11px] text-faint"
          >
            <span className="size-1.5 rounded-full bg-faint" />
            <span className="flex-1 truncate">WSL {distro.name} is stopped</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5 text-[11px]"
              onClick={() => void startDistro(distro.name)}
            >
              <Power /> Start
            </Button>
          </div>
        ))}
      {errorList.map(([name, message]) => (
        <div
          key={name}
          title={message}
          className="truncate rounded-md border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] text-danger"
        >
          {message}
        </div>
      ))}
    </div>
  );
};

export const SessionsPanel = () => {
  const sessions = useSessionsStore((s) => s.sessions);
  const loaded = useSessionsStore((s) => s.loaded);
  const refreshing = useSessionsStore((s) => s.refreshing);
  const refresh = useSessionsStore((s) => s.refresh);
  const refreshWsl = useSessionsStore((s) => s.refreshWsl);
  const folderFilter = useSettingsStore((s) => s.folderFilter);
  const includeSubfolders = useSettingsStore((s) => s.includeSubfolders);
  const activeSessionId = useWorkspaceStore(
    (s) => s.workspaces.find((w) => w.id === s.activeId)?.sessionId ?? null,
  );
  const openSessionKey = useWorkspaceStore((s) => s.workspaces.map((w) => w.sessionId).join(","));
  const openSessionIds = useMemo(() => new Set(openSessionKey.split(",")), [openSessionKey]);
  const tones = useSessionTones();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [expanded, setExpanded] = useState<Map<string, boolean>>(new Map());
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activeCwd = useWorkspaceStore(
    (s) => s.workspaces.find((w) => w.id === s.activeId)?.cwd ?? null,
  );

  const agentFilter = useSettingsStore((s) => s.agentFilter);
  const agentsPresent = useMemo(
    () => [...new Set(sessions.map((s) => s.agent))].sort(),
    [sessions],
  );

  const filtered = useMemo(() => {
    const terms = deferredQuery.toLowerCase().split(/\s+/).filter(Boolean);
    return sessions.filter((session) => {
      if (agentFilter !== "all" && session.agent !== agentFilter) return false;
      if (folderFilter) {
        const inFolder = includeSubfolders
          ? isWithin(session.cwd, folderFilter)
          : samePath(session.cwd, folderFilter);
        if (!inFolder) return false;
      }
      return terms.length === 0 || matchesQuery(session, terms);
    });
  }, [sessions, folderFilter, includeSubfolders, deferredQuery, agentFilter]);

  const pinnedIds = useSettingsStore((s) => s.pinnedSessions);
  const archivedIds = useSettingsStore((s) => s.archivedSessions);
  const showArchived = useSettingsStore((s) => s.showArchived);
  const { pinned, archived, rest } = useMemo(() => {
    const archivedSet = new Set(archivedIds);
    const pinnedSet = new Set(pinnedIds);
    const byId = new Map(filtered.map((s) => [s.id, s]));
    return {
      pinned: pinnedIds.map((id) => byId.get(id)).filter((s): s is SessionInfo => !!s),
      archived: filtered.filter((s) => archivedSet.has(s.id)),
      rest: filtered.filter((s) => !archivedSet.has(s.id) && !pinnedSet.has(s.id)),
    };
  }, [filtered, pinnedIds, archivedIds]);

  const grouped = !folderFilter || includeSubfolders;
  const groups = useMemo(() => (grouped ? groupByFolder(rest) : []), [grouped, rest]);

  const isExpanded = (cwd: string) => {
    if (deferredQuery.trim()) return true;
    const choice = expanded.get(normalizePath(cwd));
    if (choice !== undefined) return choice;
    return groups.length === 1 || (!!activeCwd && samePath(activeCwd, cwd));
  };

  const toggleGroup = (cwd: string) =>
    setExpanded((current) => new Map(current).set(normalizePath(cwd), !isExpanded(cwd)));

  const moveFocus = (event: React.KeyboardEvent) => {
    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    )
      return;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-session-row]") ?? [])];
    if (!rows.length) return;
    const current = rows.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : current + (event.key === "ArrowDown" ? 1 : -1);
    event.preventDefault();
    if (next < 0) searchRef.current?.focus();
    else rows[Math.min(next, rows.length - 1)].focus();
  };

  const renderItem = (session: SessionInfo) => (
    <SessionItem
      key={session.id}
      session={session}
      tone={tones.get(session.id) ?? null}
      isActive={session.id === activeSessionId}
      isOpen={openSessionIds.has(session.id)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Sessions">
        <IconButton label="Refresh" onClick={() => void Promise.all([refresh(), refreshWsl()])}>
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </IconButton>
        <IconButton
          label={
            folderFilter ? `New session in ${basename(folderFilter)}` : "New session in folder…"
          }
          onClick={() =>
            folderFilter ? startNewSession(folderFilter) : void startSessionInPickedFolder()
          }
        >
          <Plus />
        </IconButton>
      </PanelHeader>

      <FolderFilter />

      <div className="px-2 pb-2">
        <SearchInput
          id="sessions-search"
          inputRef={searchRef}
          value={query}
          onChange={setQuery}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown") return;
            e.preventDefault();
            listRef.current?.querySelector<HTMLElement>("[data-session-row]")?.focus();
          }}
          placeholder="Search title, prompt, branch…"
        />
        {agentsPresent.length > 1 && (
          <div className="mt-1.5">
            <Segmented<string>
              size="sm"
              value={agentsPresent.includes(agentFilter) ? agentFilter : "all"}
              onChange={(value) => useSettingsStore.getState().set({ agentFilter: value })}
              options={[
                { value: "all", label: "All agents" },
                ...agentsPresent.map((id) => ({ value: id, label: agentName(id) })),
              ]}
            />
          </div>
        )}
      </div>

      <WslStatus />

      <div
        ref={listRef}
        onKeyDown={moveFocus}
        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3"
      >
        {!loaded ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Sparkles />}
            title={query ? "No matching sessions" : "No sessions here yet"}
            description={
              query
                ? "Try a different search, or clear the folder filter."
                : "Start a Claude Code session in this folder and it will show up here."
            }
            action={
              folderFilter && !query ? (
                <Button variant="primary" size="sm" onClick={() => startNewSession(folderFilter)}>
                  <Plus /> New session
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            {pinned.length > 0 && (
              <section className="mb-1">
                <div className="flex h-8 items-center gap-1.5 px-2 text-[12.5px] font-medium text-fg">
                  <Pin className="size-3.5 fill-current text-faint" /> Pinned
                </div>
                <div className="mb-1 ml-[13px] flex flex-col gap-px border-l border-border pl-[6px]">
                  {pinned.map(renderItem)}
                </div>
              </section>
            )}
            {grouped ? (
              groups.map((group) => {
                const isCollapsed = !isExpanded(group.cwd);
                return (
                  <section key={group.cwd} className="mb-1">
                    <FolderHeader
                      group={group}
                      collapsed={isCollapsed}
                      onToggle={() => toggleGroup(group.cwd)}
                    />
                    {!isCollapsed && (
                      <div className="mb-1 ml-[13px] flex flex-col gap-px border-l border-border pl-[6px]">
                        {group.sessions.map(renderItem)}
                      </div>
                    )}
                  </section>
                );
              })
            ) : (
              <div className="flex flex-col gap-px">{rest.map(renderItem)}</div>
            )}
            {archived.length > 0 && (
              <section className="mt-2 border-t border-border pt-1">
                <button
                  type="button"
                  onClick={() => useSettingsStore.getState().set({ showArchived: !showArchived })}
                  data-session-row
                  aria-expanded={showArchived}
                  className="flex h-7 w-full items-center gap-1.5 px-1 text-[11px] font-semibold tracking-wide text-faint hover:text-muted"
                >
                  <Chevron open={showArchived} />
                  <Archive className="size-3" /> Archived
                  <span className="ml-auto pr-1 font-normal tabular-nums">{archived.length}</span>
                </button>
                {showArchived && (
                  <div className="flex flex-col gap-px">{archived.map(renderItem)}</div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};
