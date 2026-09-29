import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, GitCompare, RefreshCw } from "lucide-react";

import { EmptyState, Hint, LoadingState } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { CollapsibleSection, PanelHeader } from "@/components/ui/panel";
import { useAsync, useThrottledCallback } from "@/hooks/useAsync";
import { useSessionFile } from "@/hooks/useSessionFile";
import { agentName, CLAUDE } from "@/lib/agents/registry";
import { encodeDiffTab } from "@/lib/diff-tabs";
import { subscribeFileChanges } from "@/lib/file-events";
import { FileIcon } from "@/lib/file-icons";
import { api } from "@/lib/tauri/commands";
import { DECK_PATH_MIME } from "@/lib/terminal/input";
import { basename, cn, dirname, errorMessage, isWithin, relativePath } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { ChangedFile, GitChange, Workspace } from "@/types";

interface Badge {
  letter: string;
  className: string;
  label: string;
}

const STATUS_BADGE: Record<string, Badge> = {
  added: { letter: "A", className: "text-add", label: "Added" },
  modified: { letter: "M", className: "text-mod", label: "Modified" },
  deleted: { letter: "D", className: "text-del", label: "Deleted" },
  unchanged: { letter: "·", className: "text-faint", label: "Changed, then restored" },
};

const RELOAD_DELAY_MS = 1200;
const RELOAD_MAX_WAIT_MS = 8000;

const gitBadge = (code: string) => {
  if (code === "??" || code.includes("A")) return STATUS_BADGE.added;
  if (code.includes("D")) return STATUS_BADGE.deleted;
  return STATUS_BADGE.modified;
};

const gitMessage = (error: string) =>
  /not a git repository/i.test(error) ? "Not a git repository." : error;

const Row = ({
  workspace,
  path,
  badge,
  onOpen,
  children,
}: {
  workspace: Workspace;
  path: string;
  badge: Badge;
  onOpen: () => void;
  children?: React.ReactNode;
}) => {
  const rel = relativePath(path, workspace.cwd);
  const folder = rel === path ? dirname(path) : dirname(rel) === rel ? "" : dirname(rel);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={path}
      draggable
      onDragStart={(e) => e.dataTransfer.setData(DECK_PATH_MIME, path)}
      className="group flex h-[26px] w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-[12px] hover:bg-hover"
    >
      <FileIcon path={path} />
      <span className="max-w-[65%] min-w-0 truncate text-fg/90">{basename(path)}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{folder}</span>
      {children}
      <span
        title={badge.label}
        className={cn(
          "w-3 shrink-0 text-center font-mono text-[11px] font-semibold",
          badge.className,
        )}
      >
        {badge.letter}
      </span>
    </button>
  );
};

const loadChanges = async (cwd: string, filePath: string | null, distro: string | null) => {
  const [changes, status] = await Promise.allSettled([
    filePath ? api.sessionChanges(filePath, distro) : Promise.resolve<ChangedFile[]>([]),
    api.gitStatus(cwd),
  ]);
  return {
    files: changes.status === "fulfilled" ? changes.value : [],
    filesError: changes.status === "rejected" ? errorMessage(changes.reason) : null,
    git: status.status === "fulfilled" ? status.value : ([] as GitChange[]),
    gitError: status.status === "rejected" ? errorMessage(status.reason) : null,
  };
};

const SessionChanges = ({
  workspace,
  files,
  error,
  showUnchanged,
  sessionFile,
}: {
  workspace: Workspace;
  files: ChangedFile[];
  error: string | null;
  showUnchanged: boolean;
  sessionFile: string | null;
}) => {
  const [open, setOpen] = useState(true);
  const agent = useSessionsStore((s) => s.byId[workspace.sessionId]?.agent ?? workspace.agent);
  const visible = useMemo(
    () => files.filter((f) => showUnchanged || f.status !== "unchanged"),
    [files, showUnchanged],
  );
  const totals = visible.reduce(
    (acc, f) => ({ add: acc.add + f.additions, del: acc.del + f.deletions }),
    { add: 0, del: 0 },
  );
  const openDiff = (file: ChangedFile) => {
    const source = file.backup || agent === CLAUDE ? "session" : "git";
    useWorkspaceStore
      .getState()
      .openFile(workspace.id, encodeDiffTab({ source, path: file.path, backup: file.backup }));
  };

  return (
    <CollapsibleSection
      title="Edited in this session"
      count={visible.length}
      open={open}
      onToggle={() => setOpen((v) => !v)}
      summary={
        visible.length > 0 && (
          <>
            <span className="text-add">+{totals.add}</span>{" "}
            <span className="text-del">−{totals.del}</span>
          </>
        )
      }
    >
      {error && <Hint className="text-danger">{error}</Hint>}
      {!error && visible.length === 0 && (
        <Hint>
          {sessionFile
            ? `${agentName(agent)} hasn't changed any files in this session.`
            : "Changes appear here after the first prompt."}
        </Hint>
      )}
      {visible.map((file) => (
        <Row
          key={file.path}
          workspace={workspace}
          path={file.path}
          badge={STATUS_BADGE[file.status] ?? STATUS_BADGE.modified}
          onOpen={() => openDiff(file)}
        >
          <span className="shrink-0 font-mono text-[10.5px]">
            {file.additions > 0 && <span className="text-add">+{file.additions}</span>}
            {file.deletions > 0 && <span className="ml-1 text-del">−{file.deletions}</span>}
          </span>
        </Row>
      ))}
    </CollapsibleSection>
  );
};

const RepoChanges = ({
  workspace,
  git,
  error,
}: {
  workspace: Workspace;
  git: GitChange[];
  error: string | null;
}) => {
  const [open, setOpen] = useState(true);
  return (
    <CollapsibleSection
      title="Uncommitted in repo"
      count={error ? null : git.length}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {error && <Hint>{gitMessage(error)}</Hint>}
      {!error && git.length === 0 && <Hint>Working tree is clean.</Hint>}
      {git.map((change) => (
        <Row
          key={change.path}
          workspace={workspace}
          path={change.path}
          badge={gitBadge(change.code)}
          onOpen={() =>
            useWorkspaceStore
              .getState()
              .openFile(
                workspace.id,
                encodeDiffTab({ source: "git", path: change.path, backup: null }),
              )
          }
        />
      ))}
    </CollapsibleSection>
  );
};

const WorkspaceChanges = ({ workspace }: { workspace: Workspace }) => {
  const { filePath, distro } = useSessionFile(workspace);
  const modifiedMs = useSessionsStore((s) => s.byId[workspace.sessionId]?.modifiedMs ?? null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const { cwd } = workspace;
  const { data, loading, reload } = useAsync(
    () => loadChanges(cwd, filePath, distro),
    [cwd, filePath, distro],
  );
  const scheduleReload = useThrottledCallback(
    () => void reload(true),
    RELOAD_DELAY_MS,
    RELOAD_MAX_WAIT_MS,
  );
  const lastModified = useRef(modifiedMs);

  useEffect(() => {
    if (modifiedMs === lastModified.current) return;
    lastModified.current = modifiedMs;
    scheduleReload();
  }, [modifiedMs, scheduleReload]);

  useEffect(
    () =>
      subscribeFileChanges((change) => {
        if (change.paths.some((p) => isWithin(p, cwd))) scheduleReload();
      }),
    [cwd, scheduleReload],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={basename(cwd)}>
        <IconButton
          label={showUnchanged ? "Hide restored files" : "Show restored files"}
          onClick={() => setShowUnchanged((v) => !v)}
        >
          {showUnchanged ? <Eye /> : <EyeOff />}
        </IconButton>
        <IconButton label="Refresh" onClick={() => void reload(true)}>
          <RefreshCw className={cn(loading && "animate-spin")} />
        </IconButton>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {!data ? (
          <LoadingState />
        ) : (
          <>
            <SessionChanges
              workspace={workspace}
              files={data.files}
              error={data.filesError}
              showUnchanged={showUnchanged}
              sessionFile={filePath}
            />
            <RepoChanges workspace={workspace} git={data.git} error={data.gitError} />
          </>
        )}
      </div>
    </div>
  );
};

export const ChangesPanel = () => {
  const workspace = useActiveWorkspace();
  if (!workspace)
    return (
      <EmptyState
        className="h-full"
        icon={<GitCompare />}
        title="No session open"
        description="Open a session to see which files its agent changed."
      />
    );
  return <WorkspaceChanges key={workspace.id} workspace={workspace} />;
};
