import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, GitCompare, RefreshCw } from "lucide-react";

import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { EmptyState, Hint, LoadingState } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { PanelHeader } from "@/components/ui/panel-header";
import { ChangeRow, ChangeTree, STATUS_BADGE } from "@/features/changes/ChangeTree";
import { useAsync, useThrottledCallback } from "@/hooks/useAsync";
import { useSessionFile } from "@/hooks/useSessionFile";
import { useToggleSet } from "@/hooks/useToggleSet";
import { buildChangeTree } from "@/lib/change-tree";
import { changeDiffSource, gitChangeStatus, gitMessage } from "@/lib/changes";
import { encodeDiffTab } from "@/lib/diff-tabs";
import { subscribeFileChanges } from "@/lib/file-events";
import { api } from "@/lib/tauri/commands";
import { basename, cn, errorMessage, isWithin, sameJson } from "@/lib/utils";
import { agentName } from "@/stores/agents";
import { useSessionsStore } from "@/stores/sessions-store";
import { useActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { ChangedFile, GitChange, Workspace } from "@/types";

const RELOAD_DELAY_MS = 1200;
const RELOAD_MAX_WAIT_MS = 8000;

const loadChanges = async (cwd: string, filePath: string | null, distro: string | null) => {
  const [changes, status] = await Promise.allSettled([
    filePath ? api.sessionChanges(filePath, distro) : Promise.resolve<ChangedFile[]>([]),
    api.gitStatus(cwd),
  ]);
  return {
    files: changes.status === "fulfilled" ? changes.value : [],
    filesError: changes.status === "rejected" ? errorMessage(changes.reason) : null,
    git: status.status === "fulfilled" ? status.value : [],
    gitError: status.status === "rejected" ? errorMessage(status.reason) : null,
  };
};

type Changes = Awaited<ReturnType<typeof loadChanges>>;

type SessionChangesProps = {
  workspace: Workspace;
  files: ChangedFile[];
  error: string | null;
  showUnchanged: boolean;
  sessionFile: string | null;
};

const SessionChanges = memo(
  ({
    workspace,
    files,
    error,
    showUnchanged,
    sessionFile,
  }: SessionChangesProps) => {
    const [open, setOpen] = useState(true);
    const [collapsed, toggleFolder] = useToggleSet<string>();
    const agent = useSessionsStore((s) => s.byId[workspace.sessionId]?.agent ?? workspace.agent);
    const visible = useMemo(
      () => files.filter((f) => showUnchanged || f.status !== "unchanged"),
      [files, showUnchanged],
    );
    const tree = useMemo(
      () => buildChangeTree(visible, (f) => f.path, workspace.cwd),
      [visible, workspace.cwd],
    );
    const totals = visible.reduce(
      (acc, f) => ({ add: acc.add + f.additions, del: acc.del + f.deletions }),
      { add: 0, del: 0 },
    );
    const openDiff = (file: ChangedFile) => {
      const source = changeDiffSource(file, agent);
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
        <ChangeTree
          nodes={tree}
          collapsed={collapsed}
          onToggle={toggleFolder}
          renderFile={(file, depth) => (
            <ChangeRow
              path={file.path}
              depth={depth}
              badge={STATUS_BADGE[file.status]}
              onOpen={() => openDiff(file)}
            >
              <span className="shrink-0 font-mono text-[10.5px]">
                {file.additions > 0 && <span className="text-add">+{file.additions}</span>}
                {file.deletions > 0 && <span className="ml-1 text-del">−{file.deletions}</span>}
              </span>
            </ChangeRow>
          )}
        />
      </CollapsibleSection>
    );
  },
);
SessionChanges.displayName = "SessionChanges";

type RepoChangesProps = {
  workspace: Workspace;
  git: GitChange[];
  error: string | null;
};

const RepoChanges = memo(({ workspace, git, error }: RepoChangesProps) => {
  const [open, setOpen] = useState(true);
  const [collapsed, toggleFolder] = useToggleSet<string>();
  const tree = useMemo(
    () => buildChangeTree(git, (c) => c.path, workspace.cwd),
    [git, workspace.cwd],
  );
  return (
    <CollapsibleSection
      title="Uncommitted in repo"
      count={error ? null : git.length}
      open={open}
      onToggle={() => setOpen((v) => !v)}
    >
      {error && <Hint>{gitMessage(error)}</Hint>}
      {!error && git.length === 0 && <Hint>Working tree is clean.</Hint>}
      <ChangeTree
        nodes={tree}
        collapsed={collapsed}
        onToggle={toggleFolder}
        renderFile={(change, depth) => (
          <ChangeRow
            path={change.path}
            depth={depth}
            badge={STATUS_BADGE[gitChangeStatus(change.code)]}
            onOpen={() =>
              useWorkspaceStore
                .getState()
                .openFile(
                  workspace.id,
                  encodeDiffTab({ source: "git", path: change.path, backup: null }),
                )
            }
          />
        )}
      />
    </CollapsibleSection>
  );
});
RepoChanges.displayName = "RepoChanges";

type WorkspaceChangesProps = {
  workspace: Workspace;
};

const WorkspaceChanges = ({ workspace }: WorkspaceChangesProps) => {
  const { filePath, distro } = useSessionFile(workspace);
  const modifiedMs = useSessionsStore((s) => s.byId[workspace.sessionId]?.modifiedMs ?? null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const { cwd } = workspace;
  const previous = useRef<Changes | null>(null);
  const { data, loading, reload } = useAsync(async () => {
    const next = await loadChanges(cwd, filePath, distro);
    if (previous.current && sameJson(previous.current, next))
      return previous.current;
    previous.current = next;
    return next;
  }, [cwd, filePath, distro]);
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
