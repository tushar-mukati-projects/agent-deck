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
  resumeSession,
} from "@/actions/sessions";
import { StatusDot, type DotTone } from "@/components/ui/feedback";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { Tag } from "@/components/ui/tag";
import { TimeAgo } from "@/components/ui/time-ago";
import { resumeCommandLine } from "@/lib/agents/launch";
import { CLAUDE } from "@/lib/agents/registry";
import { sessionTitle } from "@/lib/sessions";
import { copyText, revealInExplorer } from "@/lib/tauri/system";
import { cn } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";
import { agentName, findAgent } from "@/stores/agents";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { SessionInfo } from "@/types";

type SessionMenuProps = {
  session: SessionInfo;
  isOpen: boolean;
  live: boolean;
  pinned: boolean;
  archived: boolean;
};

interface SessionItemProps {
  session: SessionInfo;
  number: number;
  folder?: string;
  tone: DotTone | null;
  isActive: boolean;
  isOpen: boolean;
}

const LIVE_TONES = new Set<DotTone>(["running", "busy", "attention", "external"]);
const ROW_HEIGHT_PX = 28;
const FOLDER_ROW_HEIGHT_PX = 42;

const SessionMenu = ({ session, isOpen, live, pinned, archived }: SessionMenuProps) => {
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
      <ContextMenuItem
        icon={<Pencil />}
        onSelect={() => useUiStore.getState().setRenameTarget(session)}
      >
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
        <ContextMenuItem
          icon={<Copy />}
          onSelect={() => void copyText(resumeCommandLine(session, useSettingsStore.getState()))}
        >
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

export const SessionItem = memo((props: SessionItemProps) => {
  const { session, number, folder, tone, isActive, isOpen } = props;
  const pinned = useSettingsStore((s) => s.pinnedSessions.includes(session.id));
  const archived = useSettingsStore((s) => s.archivedSessions.includes(session.id));
  const title = sessionTitle(session);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          data-session-row
          title={folder ? `${title}\n${session.cwd}` : title}
          onClick={() => openSessionByClick(session)}
          onDoubleClick={() => void resumeSession(session)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !isActive) return;
            e.preventDefault();
            void resumeSession(session);
          }}
          style={{
            contentVisibility: "auto",
            containIntrinsicSize: `auto ${folder ? FOLDER_ROW_HEIGHT_PX : ROW_HEIGHT_PX}px`,
          }}
          className={cn(
            "group relative flex min-h-7 w-full shrink-0 items-center gap-2 rounded-md py-1 pr-2 pl-2.5 text-left",
            isActive ? "bg-active" : "hover:bg-hover",
            archived && "opacity-60",
          )}
        >
          {isActive && (
            <span className="absolute inset-y-1.5 left-1 w-[2px] rounded-full bg-accent" />
          )}
          <span className="min-w-[2ch] shrink-0 self-start text-right text-[10.5px] leading-[18px] text-faint tabular-nums">
            {number}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              className={cn(
                "truncate text-[12px] leading-[18px]",
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
            {folder && (
              <span className="flex min-w-0 items-center gap-1 text-[10.5px] leading-4 text-faint">
                <span className="truncate">{folder}</span>
                {parseWslPath(session.cwd) && <Tag tone="badge">WSL</Tag>}
              </span>
            )}
          </span>
          {session.agent !== CLAUDE && <Tag tone="info">{agentName(session.agent)}</Tag>}
          {tone && <StatusDot tone={tone} />}
          <TimeAgo
            ms={session.modifiedMs}
            compact
            className="shrink-0 text-[10.5px] text-faint tabular-nums"
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
