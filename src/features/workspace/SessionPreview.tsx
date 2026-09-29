import { useCallback, useDeferredValue, useState } from "react";
import {
  Calendar,
  FolderOpen,
  GitBranch,
  GitFork,
  MessageSquare,
  Pencil,
  Play,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { format, isValid } from "date-fns";

import { openTypedPath } from "@/actions/files";
import { deleteSessionWithConfirm, renameSession, resumeWorkspace } from "@/actions/sessions";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Alert, SearchInput } from "@/components/ui/panel";
import { TranscriptList } from "@/features/workspace/TranscriptList";
import { useTranscript } from "@/features/workspace/useTranscript";
import { useAsync } from "@/hooks/useAsync";
import { useSessionFile } from "@/hooks/useSessionFile";
import { useExternalLive } from "@/hooks/useWorkspaceStatus";
import { isPersisted } from "@/lib/agents/launch";
import { CLAUDE, findAgent } from "@/lib/agents/registry";
import { api } from "@/lib/tauri/commands";
import { revealInExplorer } from "@/lib/tauri/system";
import { formatBytes, shortenHome } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { findWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { SessionInfo, Workspace } from "@/types";

const startedLabel = (startedAt: string) => {
  const date = new Date(startedAt);
  return isValid(date) ? format(date, "d MMM yyyy, HH:mm") : null;
};

const Meta = ({
  workspace,
  session,
}: {
  workspace: Workspace;
  session: SessionInfo | undefined;
}) => {
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
          {session.promptCount} {session.promptCount === 1 ? "prompt" : "prompts"} ·{" "}
          {formatBytes(session.size)}
        </span>
      )}
      {session?.version && <span>v{session.version}</span>}
    </div>
  );
};

const resumeLabel = (workspace: Workspace) => {
  const agent = findAgent(workspace.agent);
  if (!isPersisted(workspace) || !agent.history) return `Start ${agent.name}`;
  return agent.id === CLAUDE ? "Resume session" : `Resume in ${agent.name}`;
};

const PreviewHeader = ({
  workspace,
  session,
  folderExists,
  query,
  onQuery,
  hasItems,
}: {
  workspace: Workspace;
  session: SessionInfo | undefined;
  folderExists: boolean;
  query: string;
  onQuery: (query: string) => void;
  hasItems: boolean;
}) => {
  const agent = findAgent(workspace.agent);
  const external = useExternalLive(workspace.sessionId);
  return (
    <div className="shrink-0 border-b border-border px-6 pt-4 pb-3.5">
      <div className="group flex items-start gap-1">
        <h1
          title="Double-click to rename"
          onDoubleClick={() => session && renameSession(session)}
          className="line-clamp-2 min-w-0 cursor-text text-[15px] font-semibold tracking-tight break-words text-fg"
        >
          {workspace.title}
        </h1>
        {session && (
          <IconButton
            label="Rename"
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => renameSession(session)}
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
        </Alert>
      )}
      {external && (
        <Alert tone="warning" className="mt-3">
          This session is already open in another terminal (PID {external.pid}). Resuming it here
          too makes both copies write to the same conversation.
          {agent.canFork ? " Fork it instead for a separate branch." : ""}
        </Alert>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Button
          variant="primary"
          size="sm"
          disabled={!folderExists}
          onClick={() => void resumeWorkspace(workspace.id)}
        >
          <Play className="fill-current" /> {resumeLabel(workspace)}
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
              className="hover:bg-danger/15 hover:text-danger"
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

export const SessionPreview = ({ workspace }: { workspace: Workspace }) => {
  const session = useSessionsStore((s) => s.byId[workspace.sessionId]);
  const sessionsLoaded = useSessionsStore((s) => s.loaded);
  const { filePath, distro } = useSessionFile(workspace);
  const { items, error } = useTranscript(
    filePath,
    distro,
    session?.modifiedMs ?? 0,
    sessionsLoaded,
  );
  const { data: folderExists = true } = useAsync(
    () =>
      api
        .statPath(workspace.cwd)
        .then((stat) => stat?.kind === "dir")
        .catch(() => false),
    [workspace.cwd],
    { keepPrevious: true },
  );
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const workspaceId = workspace.id;
  const openPath = useCallback(
    (path: string) => {
      const current = findWorkspace(workspaceId);
      if (current) void openTypedPath(current, path);
    },
    [workspaceId],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PreviewHeader
        workspace={workspace}
        session={session}
        folderExists={folderExists}
        query={query}
        onQuery={setQuery}
        hasItems={!!items?.length}
      />
      <TranscriptList
        items={items}
        error={error}
        query={deferredQuery}
        emptyDescription={`Start the session and your conversation with ${findAgent(workspace.agent).name} will appear here.`}
        baseDir={workspace.cwd}
        onOpenPath={openPath}
      />
    </div>
  );
};
