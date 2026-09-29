import { memo } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  Eye,
  FolderOpen,
  GitBranch,
  GitFork,
  MessageSquare,
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

export const SessionItem = memo(({ session, tone, isActive, isOpen }: SessionItemProps) => {
  const pinned = useSettingsStore((s) => s.pinnedSessions.includes(session.id));
  const archived = useSettingsStore((s) => s.archivedSessions.includes(session.id));
  const secondary = session.lastPrompt ?? session.firstPrompt;

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
          style={{ contentVisibility: "auto", containIntrinsicSize: "auto 52px" }}
          className={cn(
            "group relative flex w-full flex-col gap-px rounded-md px-2 py-1.5 text-left transition-colors duration-75",
            isActive ? "bg-active" : "hover:bg-hover",
            archived && "opacity-60",
          )}
        >
          {isActive && (
            <span className="absolute top-1.5 bottom-1.5 -left-[7px] w-[2px] rounded-full bg-muted/70" />
          )}
          <div className="flex w-full items-center gap-2">
            {tone && <StatusDot tone={tone} />}
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[12px]",
                isActive || isOpen ? "text-fg" : "text-fg/80",
              )}
            >
              {session.title ?? "Untitled session"}
            </span>
            {session.agent !== CLAUDE && <AgentBadge agent={session.agent} />}
            {pinned && <Pin className="size-3 shrink-0 fill-current text-faint" />}
            <TimeAgo
              ms={session.modifiedMs}
              className="shrink-0 text-[10.5px] text-faint tabular-nums"
            />
          </div>
          {secondary && secondary !== session.title && (
            <p className="line-clamp-1 text-[11px] leading-snug text-faint">{secondary}</p>
          )}
          <div className="flex items-center gap-2.5 text-[10px] text-faint">
            <span className="flex items-center gap-1">
              <MessageSquare className="size-3" />
              {session.promptCount}
            </span>
            {session.gitBranch && session.gitBranch !== "HEAD" && (
              <span className="flex min-w-0 items-center gap-1">
                <GitBranch className="size-3 shrink-0" />
                <span className="truncate">{session.gitBranch}</span>
              </span>
            )}
          </div>
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
