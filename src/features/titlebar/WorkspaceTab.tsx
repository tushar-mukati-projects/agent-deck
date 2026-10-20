import { memo, useEffect, useRef } from "react";
import {
  ArrowRightToLine,
  Copy,
  FolderOpen,
  GitFork,
  Pencil,
  SquareTerminal,
  X,
  XCircle,
} from "lucide-react";

import { resumeWorkspace } from "@/actions/sessions";
import {
  closeIdleWorkspaces,
  closeOtherWorkspaces,
  closeWorkspaces,
  closeWorkspacesToRight,
} from "@/actions/workspaces";
import { StatusDot } from "@/components/ui/feedback";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { Tab } from "@/components/ui/tabs";
import { useWorkspaceTone } from "@/hooks/useWorkspaceStatus";
import { copyText, revealInExplorer } from "@/lib/tauri/system";
import { basename, cn } from "@/lib/utils";
import { findAgent } from "@/stores/agents";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

const TAB_DRAG_TYPE = "application/x-agent-deck-tab";

const TabMenu = ({ workspace, children }: { workspace: Workspace; children: React.ReactNode }) => {
  const hasSession = useSessionsStore((s) => !!s.byId[workspace.sessionId]);
  const canFork = findAgent(workspace.agent).canFork && hasSession;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          icon={<SquareTerminal />}
          onSelect={() => useWorkspaceStore.getState().openShell(workspace.id)}
        >
          New shell in {basename(workspace.cwd)}
        </ContextMenuItem>
        <ContextMenuItem
          icon={<FolderOpen />}
          onSelect={() => void revealInExplorer(workspace.cwd)}
        >
          Reveal folder in Explorer
        </ContextMenuItem>
        <ContextMenuItem
          icon={<Pencil />}
          disabled={!hasSession}
          onSelect={() => {
            const session = useSessionsStore.getState().byId[workspace.sessionId];
            if (session) useUiStore.getState().setRenameTarget(session);
          }}
        >
          Rename…
        </ContextMenuItem>
        {canFork && (
          <ContextMenuItem
            icon={<GitFork />}
            onSelect={() => void resumeWorkspace(workspace.id, { fork: true })}
          >
            Fork into new session
          </ContextMenuItem>
        )}
        <ContextMenuItem icon={<Copy />} onSelect={() => void copyText(workspace.sessionId)}>
          Copy session ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<X />} onSelect={() => void closeWorkspaces([workspace.id])}>
          Close
        </ContextMenuItem>
        <ContextMenuItem
          icon={<XCircle />}
          onSelect={() => void closeOtherWorkspaces(workspace.id)}
        >
          Close others
        </ContextMenuItem>
        <ContextMenuItem
          icon={<ArrowRightToLine />}
          onSelect={() => void closeWorkspacesToRight(workspace.id)}
        >
          Close tabs to the right
        </ContextMenuItem>
        <ContextMenuItem icon={<XCircle />} onSelect={() => void closeIdleWorkspaces()}>
          Close tabs with nothing running
        </ContextMenuItem>
        <ContextMenuItem
          icon={<XCircle />}
          onSelect={() =>
            void closeWorkspaces(useWorkspaceStore.getState().workspaces.map((w) => w.id))
          }
        >
          Close all
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

const TabBody = ({ workspace, isActive }: { workspace: Workspace; isActive: boolean }) => {
  const tone = useWorkspaceTone(workspace);
  const hidden = useSettingsStore((s) => s.hideMode);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isActive) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [isActive]);

  return (
    <TabMenu workspace={workspace}>
      <Tab
        ref={ref}
        selected={isActive}
        onSelect={() => useWorkspaceStore.getState().activate(workspace.id)}
        onClose={() => void closeWorkspaces([workspace.id])}
        closeLabel={`Close ${workspace.title}`}
        title={`${workspace.title} — ${workspace.cwd}`}
        draggable
        onDragStart={(e) => e.dataTransfer.setData(TAB_DRAG_TYPE, workspace.id)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(TAB_DRAG_TYPE)) e.preventDefault();
        }}
        onDrop={(e) => {
          const fromId = e.dataTransfer.getData(TAB_DRAG_TYPE);
          if (fromId) useWorkspaceStore.getState().reorder(fromId, workspace.id);
        }}
        className={cn(
          "h-full max-w-[220px] min-w-[120px] cursor-default border-r border-border pr-1.5 pl-3 text-[12.5px] transition-colors duration-75",
          isActive ? "bg-bg text-fg" : "text-muted hover:bg-hover/60 hover:text-fg",
        )}
        tabClassName="gap-2"
      >
        {isActive && <span className="absolute inset-x-0 top-0 h-[2px] bg-accent" />}
        {isActive && <span className="absolute inset-x-0 -bottom-px h-px bg-bg" />}
        {hidden ? null : tone ? (
          <StatusDot tone={tone} />
        ) : (
          <span className="size-[7px] shrink-0 rounded-full border border-faint/60" />
        )}
        <span className="min-w-0 flex-1 truncate">{workspace.title}</span>
      </Tab>
    </TabMenu>
  );
};

export const WorkspaceTab = memo(({ workspaceId }: { workspaceId: string }) => {
  const workspace = useWorkspace(workspaceId);
  const isActive = useWorkspaceStore((s) => s.activeId === workspaceId);
  return workspace ? <TabBody workspace={workspace} isActive={isActive} /> : null;
});
WorkspaceTab.displayName = "WorkspaceTab";
