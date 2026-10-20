import { useState } from "react";
import {
  Calendar,
  FolderOpen,
  GitBranch,
  GitFork,
  MessageSquare,
  Pencil,
  Play,
  Power,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { format, isValid } from "date-fns";

import { deleteSessionWithConfirm, resumeWorkspace } from "@/actions/sessions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { SearchInput } from "@/components/ui/search-input";
import { useExternalLive } from "@/hooks/useWorkspaceStatus";
import { isPersisted } from "@/lib/agents/launch";
import { resumeLabel } from "@/lib/agents/registry";
import { dangerHoverClass } from "@/lib/styles";
import { revealInExplorer } from "@/lib/tauri/system";
import { formatBytes, plural, shortenHome } from "@/lib/utils";
import { findAgent } from "@/stores/agents";
import { useSessionsStore } from "@/stores/sessions-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { SessionInfo, Workspace } from "@/types";

const startedLabel = (startedAt: string) => {
  const date = new Date(startedAt);
  return isValid(date) ? format(date, "d MMM yyyy, HH:mm") : null;
};

type MetaProps = {
  workspace: Workspace;
  session: SessionInfo | undefined;
};

const Meta = ({ workspace, session }: MetaProps) => {
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const started = session?.startedAt ? startedLabel(session.startedAt) : null;
  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-faint [&_svg]:size-3 [&_svg]:shrink-0">
      <span className="flex min-w-0 items-center gap-1.5 break-all" title={workspace.cwd}>
        <FolderOpen />
        {shortenHome(workspace.cwd, home)}
      </span>
      {session?.gitBranch && session.gitBranch !== "HEAD" && (
        <span className="flex min-w-0 items-center gap-1.5 break-all">
          <GitBranch />
          {session.gitBranch}
        </span>
      )}
      {started && (
        <span className="flex items-center gap-1.5">
          <Calendar />
          {started}
        </span>
      )}
      {session && (
        <span className="flex items-center gap-1.5">
          <MessageSquare />
          {plural(session.promptCount, "prompt")} · {formatBytes(session.size)}
        </span>
      )}
      {session?.version && <span>v{session.version}</span>}
    </div>
  );
};

type TakeOverButtonProps = {
  workspaceId: string;
};

const TakeOverButton = ({ workspaceId }: TakeOverButtonProps) => {
  const [closing, setClosing] = useState(false);
  return (
    <Button
      size="xs"
      disabled={closing}
      onClick={() => {
        setClosing(true);
        void resumeWorkspace(workspaceId, { takeOver: true }).finally(() => setClosing(false));
      }}
    >
      {closing ? <Spinner className="size-3.5" /> : <Power />} Close there, resume here
    </Button>
  );
};

type PreviewHeaderProps = {
  workspace: Workspace;
  session: SessionInfo | undefined;
  folderExists: boolean;
  folderError: string | null;
  query: string;
  onQuery: (query: string) => void;
  hasItems: boolean;
};

export const PreviewHeader = ({
  workspace,
  session,
  folderExists,
  folderError,
  query,
  onQuery,
  hasItems,
}: PreviewHeaderProps) => {
  const agent = findAgent(workspace.agent);
  const external = useExternalLive(workspace.sessionId);
  return (
    <div className="shrink-0 border-b border-border px-6 pt-4 pb-3.5">
      <div className="group flex items-start gap-1">
        <h1
          title="Double-click to rename"
          onDoubleClick={() =>
            session && useUiStore.getState().setRenameTarget(session)
          }
          className="line-clamp-2 min-w-0 cursor-text text-[15px] font-semibold tracking-tight break-words text-fg"
        >
          {workspace.title}
        </h1>
        {session && (
          <IconButton
            label="Rename"
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => useUiStore.getState().setRenameTarget(session)}
          >
            <Pencil />
          </IconButton>
        )}
      </div>
      <Meta workspace={workspace} session={session} />

      {!folderExists && (
        <Alert tone="danger" className="mt-3">
          This folder isn't reachable from this machine. It may be on another host, in a stopped WSL
          distro, or it was moved, so the session can't be resumed here.
          {folderError && <span className="mt-1 block whitespace-pre-wrap">{folderError}</span>}
        </Alert>
      )}
      {external && (
        <Alert
          tone="warning"
          className="mt-3"
          action={<TakeOverButton workspaceId={workspace.id} />}
        >
          This session is already open in another terminal (PID {external.pid}). Close it there to
          continue here{agent.canFork ? ", or fork it to keep both" : ""}.
        </Alert>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button
          variant="primary"
          size="sm"
          disabled={!folderExists}
          onClick={() => void resumeWorkspace(workspace.id)}
        >
          <Play className="fill-current" />{" "}
          {resumeLabel(agent, isPersisted(workspace, useSessionsStore.getState().byId))}
          <Kbd
            keys="Enter"
            className="ml-0.5 opacity-60 [&_kbd]:border-on-accent/25 [&_kbd]:bg-on-accent/10 [&_kbd]:text-on-accent"
          />
        </Button>
        {session && agent.canFork && (
          <Button
            size="sm"
            disabled={!folderExists}
            onClick={() => void resumeWorkspace(workspace.id, { fork: true })}
          >
            <GitFork /> Fork
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={!folderExists}
          onClick={() => useWorkspaceStore.getState().openShell(workspace.id)}
        >
          <SquareTerminal /> Shell
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!folderExists}
          onClick={() => void revealInExplorer(workspace.cwd)}
        >
          <FolderOpen /> Folder
        </Button>
        <div className="ml-auto flex items-center gap-1.5">
          {hasItems && (
            <SearchInput
              value={query}
              onChange={onQuery}
              placeholder="Find in conversation"
              aria-label="Find in conversation"
              className="w-[200px]"
            />
          )}
          {session && (
            <Button
              size="sm"
              variant="ghost"
              className={dangerHoverClass}
              onClick={() => void deleteSessionWithConfirm(session)}
            >
              <Trash2 /> Delete
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
