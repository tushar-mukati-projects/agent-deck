import { Copy, FolderOpen, Pencil, SquareTerminal, X, XCircle } from "lucide-react";

import { StatusDot } from "@/components/ui/feedback";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { closeWorkspaceWithConfirm } from "@/hooks/useCloseWorkspace";
import { useWorkspaceTone } from "@/hooks/useWorkspaceStatus";
import { copyText, revealInExplorer } from "@/lib/tauri/system";
import { basename, cn } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore, type WorkspaceRecord } from "@/stores/workspace-store";

const TAB_DRAG_TYPE = "application/x-claude-deck-tab";

export const WorkspaceTab = ({ workspace }: { workspace: WorkspaceRecord }) => {
  const isActive = useWorkspaceStore((s) => s.activeId === workspace.id);
  const activate = useWorkspaceStore((s) => s.activate);
  const reorder = useWorkspaceStore((s) => s.reorder);
  const tone = useWorkspaceTone(workspace);
  const session = useSessionsStore((s) => s.byId[workspace.sessionId]);

  const closeOthers = async () => {
    const others = useWorkspaceStore.getState().workspaces.filter((w) => w.id !== workspace.id);
    for (const other of others) await closeWorkspaceWithConfirm(other.id);
  };

  const handleMouseDown = (event: React.MouseEvent) => {
    if (event.button === 1) {
      event.preventDefault();
      void closeWorkspaceWithConfirm(workspace.id);
    }
  };

  const handleDrop = (event: React.DragEvent) => {
    const fromId = event.dataTransfer.getData(TAB_DRAG_TYPE);
    if (fromId) reorder(fromId, workspace.id);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="tab"
          aria-selected={isActive}
          draggable
          onDragStart={(e) => e.dataTransfer.setData(TAB_DRAG_TYPE, workspace.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          onMouseDown={handleMouseDown}
          onClick={() => activate(workspace.id)}
          className={cn(
            "group relative flex h-full max-w-[220px] min-w-[120px] shrink-0 cursor-default items-center gap-2 border-r border-border pr-1.5 pl-3 text-[12.5px] transition-colors duration-75",
            isActive ? "bg-bg text-fg" : "text-muted hover:bg-hover/60 hover:text-fg",
          )}
        >
          {isActive && <span className="absolute inset-x-0 top-0 h-[2px] bg-accent" />}
          {isActive && <span className="absolute inset-x-0 -bottom-px h-px bg-bg" />}
          {tone ? <StatusDot tone={tone} /> : <span className="size-[7px] shrink-0 rounded-full border border-faint/60" />}
          <Tooltip content={`${workspace.title} — ${workspace.cwd}`}>
            <span className="min-w-0 flex-1 truncate">{workspace.title}</span>
          </Tooltip>
          <button
            type="button"
            aria-label="Close tab"
            onClick={(e) => {
              e.stopPropagation();
              void closeWorkspaceWithConfirm(workspace.id);
            }}
            className={cn(
              "flex size-5 shrink-0 items-center justify-center rounded text-faint hover:bg-active hover:text-fg",
              isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <X className="size-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon={<SquareTerminal />} onSelect={() => useWorkspaceStore.getState().openShell(workspace.id)}>
          New shell in {basename(workspace.cwd)}
        </ContextMenuItem>
        <ContextMenuItem icon={<FolderOpen />} onSelect={() => void revealInExplorer(workspace.cwd)}>
          Reveal folder in Explorer
        </ContextMenuItem>
        <ContextMenuItem
          icon={<Pencil />}
          disabled={!session}
          onSelect={() => session && useUiStore.getState().setRenameTarget(session)}
        >
          Rename…
        </ContextMenuItem>
        <ContextMenuItem icon={<Copy />} onSelect={() => void copyText(workspace.sessionId)}>
          Copy session ID
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<X />} onSelect={() => void closeWorkspaceWithConfirm(workspace.id)}>
          Close
        </ContextMenuItem>
        <ContextMenuItem icon={<XCircle />} onSelect={() => void closeOthers()}>
          Close others
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};
