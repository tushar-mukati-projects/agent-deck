import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, Pin, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { startNewSession, startSessionInPickedFolder } from "@/actions/sessions";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, StatusDot, type DotTone } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Chevron, PanelHeader, SearchInput, Segmented } from "@/components/ui/panel";
import { FolderFilter } from "@/features/sidebar/FolderFilter";
import { SessionItem } from "@/features/sidebar/SessionItem";
import { useSessionTones } from "@/features/sidebar/useSessionTones";
import { WslStatus } from "@/features/sidebar/WslStatus";
import { folderIcon } from "@/lib/file-icons";
import {
  agentsIn,
  effectiveAgent,
  folderHints,
  groupByFolder,
  partitionSessions,
  type SessionGroup,
} from "@/lib/session-list";
import { basename, cn, normalizePath, samePath, toggled } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";
import { agentName } from "@/stores/agents";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { activeWorkspaceOf, useWorkspaceStore } from "@/stores/workspace-store";
import type { SessionInfo } from "@/types";

const RENDER_STEP = 150;
const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);
const sectionClass =
  "flex h-7 w-full items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wide text-faint";
const nestedListClass = "mb-1 ml-[13px] flex flex-col gap-px border-l border-border pl-[6px]";
const TONE_PRIORITY: DotTone[] = ["attention", "busy", "running", "external"];

const groupTone = (sessions: SessionInfo[], tones: Map<string, DotTone>) => {
  const present = new Set(sessions.map((s) => tones.get(s.id)));
  return TONE_PRIORITY.find((tone) => present.has(tone)) ?? null;
};

const FolderHeader = ({
  group,
  collapsed,
  hint,
  tone,
  onToggle,
}: {
  group: SessionGroup;
  collapsed: boolean;
  hint: string | null;
  tone: DotTone | null;
  onToggle: () => void;
}) => {
  const name = basename(group.cwd);
  const { icon: Icon, color } = folderIcon(name, !collapsed);
  return (
    <div className="group sticky top-0 z-10 flex h-8 items-center gap-1 bg-panel pr-1 pl-1">
      <button
        type="button"
        onClick={onToggle}
        title={group.cwd}
        data-session-row
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[12.5px] font-medium text-fg/90 hover:text-fg"
      >
        <Chevron open={!collapsed} className="text-faint" />
        <Icon className={cn("size-3.5 shrink-0", color)} />
        <span className="min-w-0 truncate">{name}</span>
        {parseWslPath(group.cwd) && (
          <span className="shrink-0 rounded border border-badge/30 bg-badge/10 px-1 text-[9px] leading-[14px] font-bold tracking-wider text-badge">
            WSL
          </span>
        )}
        {hint && (
          <span className="min-w-0 shrink-[2] truncate text-[11px] font-normal text-faint">
            {hint}
          </span>
        )}
      </button>
      {collapsed && tone && <StatusDot tone={tone} className="mr-1" />}
      <span className="pr-1 text-[10.5px] text-faint tabular-nums group-focus-within:hidden group-hover:hidden">
        {group.sessions.length}
      </span>
      <IconButton
        label={`New session in ${name}`}
        className="hidden group-focus-within:inline-flex group-hover:inline-flex"
        onClick={() => startNewSession(group.cwd)}
      >
        <Plus />
      </IconButton>
    </div>
  );
};

const useExpandedGroups = (searching: boolean, groups: SessionGroup[]) => {
  const [saved, setSaved] = useState<Map<string, boolean>>(new Map());
  const [collapsedInSearch, setCollapsedInSearch] = useState<Set<string>>(new Set());
  const activeCwd = useWorkspaceStore((s) => activeWorkspaceOf(s)?.cwd ?? null);

  useEffect(() => {
    if (!searching) setCollapsedInSearch((current) => (current.size ? new Set() : current));
  }, [searching]);

  const isExpanded = (cwd: string) => {
    const key = normalizePath(cwd);
    if (searching) return !collapsedInSearch.has(key);
    const choice = saved.get(key);
    if (choice !== undefined) return choice;
    return groups.length === 1 || (!!activeCwd && samePath(activeCwd, cwd));
  };

  const toggle = (cwd: string) => {
    const key = normalizePath(cwd);
    if (searching) {
      setCollapsedInSearch((current) => toggled(current, key));
    } else {
      setSaved((current) => new Map(current).set(key, !isExpanded(cwd)));
    }
  };

  return { isExpanded, toggle };
};

const emptyMessage = (query: string, folderFilter: string | null) => {
  if (query)
    return {
      title: "No matching sessions",
      description: folderFilter
        ? "Try a different search, or clear the folder filter."
        : "Try a different search.",
    };
  if (folderFilter)
    return {
      title: "No sessions in this folder yet",
      description: `Start a session in ${basename(folderFilter)} and it will show up here.`,
    };
  return {
    title: "No sessions yet",
    description: "Start a session with any agent and it will show up here.",
  };
};

const RefreshButton = () => {
  const refreshing = useSessionsStore((s) => s.refreshing);
  return (
    <IconButton
      label="Refresh"
      onClick={() => {
        const store = useSessionsStore.getState();
        void store.refresh();
        void store.refreshWsl();
      }}
    >
      <RefreshCw className={cn(refreshing && "animate-spin")} />
    </IconButton>
  );
};

const SessionList = memo(
  ({
    query: deferredQuery,
    listRef,
    searchRef,
  }: {
    query: string;
    listRef: React.RefObject<HTMLDivElement | null>;
    searchRef: React.RefObject<HTMLInputElement | null>;
  }) => {
    const sessions = useSessionsStore((s) => s.sessions);
    const loaded = useSessionsStore((s) => s.loaded);
    const loadError = useSessionsStore((s) => s.loadError);
    const { folderFilter, includeSubfolders, agentFilter, pinnedIds, archivedIds, showArchived } =
      useSettingsStore(
        useShallow((s) => ({
          folderFilter: s.folderFilter,
          includeSubfolders: s.includeSubfolders,
          agentFilter: s.agentFilter,
          pinnedIds: s.pinnedSessions,
          archivedIds: s.archivedSessions,
          showArchived: s.showArchived,
        })),
      );
    const activeSessionId = useWorkspaceStore((s) => activeWorkspaceOf(s)?.sessionId ?? null);
    const openSessionIds = useWorkspaceStore(
      useShallow((s) => s.workspaces.map((w) => w.sessionId)),
    );
    const tones = useSessionTones();
    const [renderLimit, setRenderLimit] = useState(RENDER_STEP);

    useEffect(() => setRenderLimit(RENDER_STEP), [deferredQuery, folderFilter, agentFilter]);

    const { total, pinned, archived, rest } = useMemo(
      () =>
        partitionSessions(sessions, {
          agent: agentFilter,
          folder: folderFilter,
          includeSubfolders,
          query: deferredQuery,
          pinnedIds,
          archivedIds,
        }),
      [
        sessions,
        agentFilter,
        folderFilter,
        includeSubfolders,
        deferredQuery,
        pinnedIds,
        archivedIds,
      ],
    );

    const grouped = !folderFilter || includeSubfolders;
    const groups = useMemo(() => (grouped ? groupByFolder(rest) : []), [grouped, rest]);
    const expansion = useExpandedGroups(!!deferredQuery, groups);
    const hints = useMemo(() => folderHints(groups), [groups]);
    const groupTones = useMemo(
      () => new Map(groups.map((group) => [group.cwd, groupTone(group.sessions, tones)])),
      [groups, tones],
    );
    const openIds = useMemo(() => new Set(openSessionIds), [openSessionIds]);

    const moveFocus = (event: React.KeyboardEvent) => {
      if (!NAV_KEYS.has(event.key) || !event.currentTarget.contains(event.target as Node)) return;
      const rows = [
        ...(listRef.current?.querySelectorAll<HTMLElement>("[data-session-row]") ?? []),
      ];
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

    let budget = renderLimit;
    const take = (list: SessionInfo[]) => {
      const shown = list.slice(0, Math.max(0, budget));
      budget -= list.length;
      return shown;
    };
    const renderItem = (session: SessionInfo, index: number) => (
      <SessionItem
        key={session.id}
        session={session}
        number={index + 1}
        tone={tones.get(session.id) ?? null}
        isActive={session.id === activeSessionId}
        isOpen={openIds.has(session.id)}
      />
    );

    const renderGroups = () =>
      groups.map((group) => {
        const collapsed = !expansion.isExpanded(group.cwd);
        const shown = collapsed ? [] : take(group.sessions);
        return (
          <section key={group.cwd} className="mb-1">
            <FolderHeader
              group={group}
              collapsed={collapsed}
              hint={hints.get(group.cwd) ?? null}
              tone={groupTones.get(group.cwd) ?? null}
              onToggle={() => expansion.toggle(group.cwd)}
            />
            {shown.length > 0 && <div className={nestedListClass}>{shown.map(renderItem)}</div>}
          </section>
        );
      });

    const renderList = () => {
      const pinnedShown = take(pinned);
      const body = grouped ? (
        renderGroups()
      ) : (
        <div className="flex flex-col gap-px">{take(rest).map(renderItem)}</div>
      );
      const archivedShown = showArchived ? take(archived) : [];
      return (
        <>
          {pinnedShown.length > 0 && (
            <section className="mb-1">
              <div className={sectionClass}>
                <Pin className="size-3 fill-current" /> Pinned
                <span className="ml-auto pr-1 font-normal tabular-nums">{pinned.length}</span>
              </div>
              <div className={nestedListClass}>{pinnedShown.map(renderItem)}</div>
            </section>
          )}
          {body}
          {archived.length > 0 && (
            <section className="mt-2 border-t border-border pt-1">
              <button
                type="button"
                onClick={() => useSettingsStore.getState().set({ showArchived: !showArchived })}
                data-session-row
                aria-expanded={showArchived}
                className={cn(sectionClass, "hover:text-muted")}
              >
                <Chevron open={showArchived} />
                <Archive className="size-3" /> Archived
                <span className="ml-auto pr-1 font-normal tabular-nums">{archived.length}</span>
              </button>
              {archivedShown.length > 0 && (
                <div className="flex flex-col gap-px">{archivedShown.map(renderItem)}</div>
              )}
            </section>
          )}
          {budget < 0 && (
            <div className="flex justify-center py-2">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setRenderLimit((n) => n + RENDER_STEP)}
              >
                Show {Math.min(-budget, RENDER_STEP)} more
              </Button>
            </div>
          )}
        </>
      );
    };

    const empty = emptyMessage(deferredQuery, folderFilter);

    return (
      <div
        ref={listRef}
        onKeyDown={moveFocus}
        className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3"
      >
        {!loaded ? (
          <LoadingState />
        ) : loadError && sessions.length === 0 ? (
          <EmptyState
            icon={<AlertTriangle />}
            title="Couldn't load sessions"
            description={loadError}
            action={
              <Button size="sm" onClick={() => void useSessionsStore.getState().refresh()}>
                <RefreshCw /> Try again
              </Button>
            }
          />
        ) : total === 0 ? (
          <EmptyState
            icon={<Sparkles />}
            title={empty.title}
            description={empty.description}
            action={
              folderFilter && !deferredQuery ? (
                <Button variant="primary" size="sm" onClick={() => startNewSession(folderFilter)}>
                  <Plus /> New session
                </Button>
              ) : undefined
            }
          />
        ) : (
          renderList()
        )}
      </div>
    );
  },
);
SessionList.displayName = "SessionList";

export const SessionsPanel = () => {
  const sessions = useSessionsStore((s) => s.sessions);
  const folderFilter = useSettingsStore((s) => s.folderFilter);
  const agentFilter = useSettingsStore((s) => s.agentFilter);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const agentsPresent = useMemo(() => agentsIn(sessions), [sessions]);
  const agent = effectiveAgent(agentFilter, sessions);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Sessions">
        <RefreshButton />
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
          placeholder="Search sessions…"
          aria-label="Search sessions"
        />
        {agentsPresent.length > 1 && (
          <div className="mt-1.5">
            <Segmented<string>
              size="sm"
              value={agent}
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

      <SessionList query={deferredQuery} listRef={listRef} searchRef={searchRef} />
    </div>
  );
};
