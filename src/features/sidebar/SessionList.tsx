import { memo, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Archive, Pin, Plus, RefreshCw, Sparkles } from "lucide-react";
import { useShallow } from "zustand/react/shallow";

import { startNewSession } from "@/actions/sessions";
import { Button } from "@/components/ui/button";
import { Chevron } from "@/components/ui/chevron";
import { EmptyState, LoadingState } from "@/components/ui/feedback";
import { FolderHeader } from "@/features/sidebar/FolderHeader";
import { SessionItem } from "@/features/sidebar/SessionItem";
import { useExpandedGroups } from "@/features/sidebar/useExpandedGroups";
import { useSessionTones } from "@/features/sidebar/useSessionTones";
import { folderHints, groupByFolder, partitionSessions } from "@/lib/session-list";
import { emptyMessage, groupTone } from "@/lib/sessions-panel";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { activeWorkspaceOf, useWorkspaceStore } from "@/stores/workspace-store";
import type { SessionInfo } from "@/types";

const RENDER_STEP = 150;
const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);
const sectionClass =
  "flex h-7 w-full items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wide text-faint";
const nestedListClass = "mb-1 ml-[13px] flex flex-col gap-px border-l border-border pl-[6px]";

type SessionListProps = {
  query: string;
  listRef: React.RefObject<HTMLDivElement | null>;
  searchRef: React.RefObject<HTMLInputElement | null>;
};

export const SessionList = memo(
  ({ query: deferredQuery, listRef, searchRef }: SessionListProps) => {
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
