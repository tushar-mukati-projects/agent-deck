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
import {
  emptyMessage,
  folderHints,
  groupByFolder,
  groupTone,
  partitionSessions,
  splitSingleFolders,
} from "@/lib/session-list";
import { basename, cn } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { activeWorkspaceOf, useWorkspaceStore } from "@/stores/workspace-store";
import type { SessionInfo } from "@/types";

const RENDER_STEP_ROWS = 150;
const FOLDER_PREVIEW_ROWS = 5;
const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);
const sectionClass =
  "flex h-7 w-full items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wide text-faint uppercase";
const stickyClass = "sticky top-0 z-10 bg-panel";
const listClass = "flex flex-col gap-px";

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
    const [renderLimit, setRenderLimit] = useState(RENDER_STEP_ROWS);

    useEffect(() => setRenderLimit(RENDER_STEP_ROWS), [deferredQuery, folderFilter, agentFilter]);

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
    const sections = useMemo(() => splitSingleFolders(groups), [groups]);
    const expansion = useExpandedGroups(!!deferredQuery, groups);
    const hints = useMemo(() => folderHints(groups), [groups]);
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
    const renderItem = (session: SessionInfo, folder?: string) => (
      <SessionItem
        key={session.id}
        session={session}
        folder={folder}
        tone={tones.get(session.id) ?? null}
        isActive={session.id === activeSessionId}
        isOpen={openIds.has(session.id)}
      />
    );
    const renderWithFolder = (session: SessionInfo) => renderItem(session, basename(session.cwd));

    const renderGroups = () => [
      ...sections.folders.map((group) => {
        const expanded = expansion.isExpanded(group.cwd);
        const hidden = expanded ? [] : group.sessions.slice(FOLDER_PREVIEW_ROWS);
        const extra = group.sessions.length - FOLDER_PREVIEW_ROWS;
        const shown = take(group.sessions.slice(0, group.sessions.length - hidden.length));
        return (
          <section key={group.cwd} className="mb-2">
            <FolderHeader
              group={group}
              hint={hints.get(group.cwd) ?? null}
              tone={groupTone(hidden, tones)}
            />
            <div className={listClass}>{shown.map((session) => renderItem(session))}</div>
            {extra > 0 && !deferredQuery && (
              <button
                type="button"
                data-session-row
                onClick={() => expansion.toggle(group.cwd)}
                className="h-6 w-full rounded-md px-2.5 text-left text-[11px] text-faint hover:bg-hover hover:text-fg"
              >
                {expanded ? "Show less" : `Show ${extra} more`}
              </button>
            )}
          </section>
        );
      }),
      sections.singles.length > 0 && (
        <section key="other-folders" className="mb-2">
          <div className={cn(sectionClass, stickyClass)}>
            Other folders
            <span className="ml-auto pr-1 font-normal tabular-nums">{sections.singles.length}</span>
          </div>
          <div className={listClass}>{take(sections.singles).map(renderWithFolder)}</div>
        </section>
      ),
    ];

    const renderList = () => {
      const pinnedShown = take(pinned);
      const body = grouped ? (
        renderGroups()
      ) : (
        <div className={listClass}>{take(rest).map((session) => renderItem(session))}</div>
      );
      const archivedShown = showArchived ? take(archived) : [];
      return (
        <>
          {pinnedShown.length > 0 && (
            <section className="mb-2">
              <div className={cn(sectionClass, stickyClass)}>
                <Pin className="size-3 fill-current" /> Pinned
                <span className="ml-auto pr-1 font-normal tabular-nums">{pinned.length}</span>
              </div>
              <div className={listClass}>{pinnedShown.map(renderWithFolder)}</div>
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
                <div className={listClass}>{archivedShown.map(renderWithFolder)}</div>
              )}
            </section>
          )}
          {budget < 0 && (
            <div className="flex justify-center py-2">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setRenderLimit((n) => n + RENDER_STEP_ROWS)}
              >
                Show {Math.min(-budget, RENDER_STEP_ROWS)} more
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
