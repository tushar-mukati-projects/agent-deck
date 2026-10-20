import { memo, useMemo, useState } from "react";

import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { Hint } from "@/components/ui/feedback";
import { ChangeRow, ChangeTree, STATUS_BADGE } from "@/features/changes/ChangeTree";
import { useToggleSet } from "@/hooks/useToggleSet";
import { buildChangeTree } from "@/lib/change-tree";
import { changeDiffSource, gitChangeStatus, gitMessage } from "@/lib/changes";
import { encodeDiffTab } from "@/lib/diff-tabs";
import { agentName } from "@/stores/agents";
import { useSessionsStore } from "@/stores/sessions-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ChangedFile, GitChange, Workspace } from "@/types";

type SessionChangesProps = {
  workspace: Workspace;
  files: ChangedFile[];
  error: string | null;
  showUnchanged: boolean;
  sessionFile: string | null;
};

export const SessionChanges = memo(
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

export const RepoChanges = memo(({ workspace, git, error }: RepoChangesProps) => {
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
