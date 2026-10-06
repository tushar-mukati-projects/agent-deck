import { memo } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Eye,
  FolderOpen,
  GitFork,
  Pencil,
  Pin,
  PinOff,
  Play,
  SquareTerminal,
  Trash2,
} from "lucide-react";

import {
  deleteSessionWithConfirm,
  forkSession,
  openSessionByClick,
  previewSession,
  renameSession,
  resumeSession,
} from "@/actions/sessions";
import { AgentBadge } from "@/components/ui/agent-badge";
import { StatusDot, type DotTone } from "@/components/ui/feedback";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { TimeAgo } from "@/components/ui/time-ago";
import { resumeCommandLine } from "@/lib/agents/launch";
import { CLAUDE, findAgent } from "@/lib/agents/registry";
import { copyText, revealInExplorer } from "@/lib/tauri/system";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { SessionInfo } from "@/types";

interface SessionItemProps {
  session: SessionInfo;
  number: number;
  tone: DotTone | null;
  isActive: boolean;
  isOpen: boolean;
}

const LIVE_TONES = new Set<DotTone>(["running", "busy", "attention", "external"]);

const SessionMenu = ({
  session,
  isOpen,
  live,
  pinned,
  archived,
}: {
  session: SessionInfo;
  isOpen: boolean;
  live: boolean;
  pinned: boolean;
  archived: boolean;
}) => {
  const { togglePinned, toggleArchived } = useSettingsStore.getState();
  const agent = findAgent(session.agent);

  return (
    <ContextMenuContent>
      <ContextMenuItem icon={<Play />} onSelect={() => void resumeSession(session)}>
        {isOpen ? "Resume in its tab" : "Resume session"}
      </ContextMenuItem>
      <ContextMenuItem icon={<Eye />} onSelect={() => previewSession(session)}>
        Preview conversation
      </ContextMenuItem>
      {agent.canFork && (
        <ContextMenuItem icon={<GitFork />} onSelect={() => forkSession(session)}>
          Fork into new session
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={pinned ? <PinOff /> : <Pin />}
        onSelect={() => togglePinned(session.id)}
      >
        {pinned ? "Unpin" : "Pin to top"}
      </ContextMenuItem>
      <ContextMenuItem icon={<Pencil />} onSelect={() => renameSession(session)}>
        Rename…
      </ContextMenuItem>
      <ContextMenuItem
        icon={archived ? <ArchiveRestore /> : <Archive />}
        onSelect={() => toggleArchived(session.id)}
      >
        {archived ? "Unarchive" : "Archive"}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<SquareTerminal />}
        onSelect={() => useWorkspaceStore.getState().openShell(previewSession(session))}
      >
        Open shell in folder
      </ContextMenuItem>
      <ContextMenuItem icon={<FolderOpen />} onSelect={() => void revealInExplorer(session.cwd)}>
        Reveal folder in Explorer
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem icon={<Copy />} onSelect={() => void copyText(session.id)}>
        Copy session ID
      </ContextMenuItem>
      {agent.history && (
        <ContextMenuItem icon={<Copy />} onSelect={() => void copyText(resumeCommandLine(session))}>
          Copy resume command
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        icon={<Trash2 />}
        destructive
        disabled={live}
        onSelect={() => void deleteSessionWithConfirm(session)}
      >
        Delete session…
      </ContextMenuItem>
    </ContextMenuContent>
  );
};

export const SessionItem = memo(({ session, number, tone, isActive, isOpen }: SessionItemProps) => {
  const pinned = useSettingsStore((s) => s.pinnedSessions.includes(session.id));
  const archived = useSettingsStore((s) => s.archivedSessions.includes(session.id));
  const title = session.title ?? "Untitled session";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          data-session-row
          onClick={() => openSessionByClick(session)}
          onDoubleClick={() => void resumeSession(session)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !isActive) return;
            e.preventDefault();
            void resumeSession(session);
          }}
          style={{ contentVisibility: "auto", containIntrinsicSize: "auto 28px" }}
          className={cn(
            "group relative flex min-h-7 w-full shrink-0 items-start gap-2 rounded-md py-[5px] pr-2 pl-1.5 text-left",
            "after:absolute after:inset-x-2 after:bottom-0 after:h-px after:bg-fg/[0.07] last:after:hidden",
            isActive ? "bg-active after:hidden" : "hover:bg-hover hover:after:opacity-0",
            archived && "opacity-60",
          )}
        >
          {isActive && (
            <span className="absolute inset-y-1.5 -left-[7px] w-[2px] rounded-full bg-accent" />
          )}
          <span className="min-w-[2ch] shrink-0 text-right text-[10.5px] leading-[18px] text-faint tabular-nums">
            {number}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 text-[12px] leading-[18px] wrap-anywhere",
              !session.title && "italic",
              isActive
                ? "font-medium text-fg"
                : isOpen
                  ? "text-fg"
                  : "text-fg/75 group-hover:text-fg",
            )}
          >
            {title}
          </span>
          {session.agent !== CLAUDE && <AgentBadge agent={session.agent} className="mt-0.5" />}
          {tone && (
            <span className="flex h-[18px] shrink-0 items-center">
              <StatusDot tone={tone} />
            </span>
          )}
          <TimeAgo
            ms={session.modifiedMs}
            compact
            className="shrink-0 text-[10.5px] leading-[18px] text-faint tabular-nums"
          />
        </button>
      </ContextMenuTrigger>
      <SessionMenu
        session={session}
        isOpen={isOpen}
        live={!!tone && LIVE_TONES.has(tone)}
        pinned={pinned}
        archived={archived}
      />
    </ContextMenu>
  );
});
SessionItem.displayName = "SessionItem";
