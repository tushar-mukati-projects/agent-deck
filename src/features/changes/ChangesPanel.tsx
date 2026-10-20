import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, GitCompare, RefreshCw } from "lucide-react";

import { EmptyState, Hint, LoadingState } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Chevron, CollapsibleSection, PanelHeader } from "@/components/ui/panel";
import { useAsync, useThrottledCallback } from "@/hooks/useAsync";
import { useSessionFile } from "@/hooks/useSessionFile";
import { CLAUDE } from "@/lib/agents/registry";
import { buildChangeTree, type ChangeFolder, type ChangeNode } from "@/lib/change-tree";
import { encodeDiffTab } from "@/lib/diff-tabs";
import { subscribeFileChanges } from "@/lib/file-events";
import { FileIcon, folderIcon } from "@/lib/file-icons";
import { api } from "@/lib/tauri/commands";
import { DECK_PATH_MIME } from "@/lib/terminal/input";
import {
  basename,
  cn,
  errorMessage,
  isWithin,
  sameJson,
  shortenHome,
  toggled,
} from "@/lib/utils";
import { agentName } from "@/stores/agents";
import { useSessionsStore } from "@/stores/sessions-store";
import { useActiveWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { ChangedFile, ChangeStatus, GitChange, Workspace } from "@/types";

interface Badge {
  letter: string;
  className: string;
  label: string;
}

const STATUS_BADGE: Record<ChangeStatus, Badge> = {
  added: { letter: "A", className: "text-add", label: "Added" },
  modified: { letter: "M", className: "text-mod", label: "Modified" },
  deleted: { letter: "D", className: "text-del", label: "Deleted" },
  unchanged: { letter: "·", className: "text-faint", label: "Changed, then restored" },
};

const RELOAD_DELAY_MS = 1200;
const RELOAD_MAX_WAIT_MS = 8000;
const INDENT = 12;

const rowClass =
  "relative flex h-[26px] w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-[12px] hover:bg-hover";

const gitBadge = (code: string) => {
  if (code === "??" || code.includes("A")) return STATUS_BADGE.added;
  if (code.includes("D")) return STATUS_BADGE.deleted;
  return STATUS_BADGE.modified;
};

const gitMessage = (error: string) =>
  /not a git repository/i.test(error) ? "Not a git repository." : error;

const indent = (depth: number) => ({ paddingLeft: 8 + depth * INDENT });

const Guides = ({ depth }: { depth: number }) =>
  Array.from({ length: depth }, (_, level) => (
    <span
      key={level}
      className="absolute top-0 bottom-0 w-px bg-border"
      style={{ left: 14 + level * INDENT }}
    />
  ));

const Row = ({
  path,
  depth,
  badge,
  onOpen,
  children,
}: {
  path: string;
  depth: number;
  badge: Badge;
  onOpen: () => void;
  children?: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onOpen}
    title={path}
    draggable
    onDragStart={(e) => e.dataTransfer.setData(DECK_PATH_MIME, path)}
    style={indent(depth)}
    className={rowClass}
  >
    <Guides depth={depth} />
    <span className="w-3 shrink-0" />
    <FileIcon path={path} />
    <span className="min-w-0 flex-1 truncate text-fg/90">{basename(path)}</span>
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

const FolderRow = ({
  folder,
  depth,
  open,
  onToggle,
}: {
  folder: ChangeFolder<unknown>;
  depth: number;
  open: boolean;
  onToggle: () => void;
}) => {
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const { icon: Icon, color } = folderIcon(basename(folder.path), open);
  return (
    <button
      type="button"
      onClick={onToggle}
      title={folder.path}
      aria-expanded={open}
      style={indent(depth)}
      className={cn(rowClass, "text-fg/85")}
    >
      <Guides depth={depth} />
      <Chevron open={open} className="text-faint" />
      <Icon className={cn("size-3.5 shrink-0", color)} />
      <span className="min-w-0 truncate">{shortenHome(folder.name, home)}</span>
    </button>
  );
};

const useCollapsed = () => {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((key: string) => setCollapsed((current) => toggled(current, key)), []);
  return [collapsed, toggle] as const;
};

interface ChangeTreeProps<T> {
  nodes: ChangeNode<T>[];
  depth?: number;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  renderFile: (item: T, depth: number) => React.ReactNode;
}

const ChangeTree = <T,>({
  nodes,
  depth = 0,
  collapsed,
  onToggle,
  renderFile,
}: ChangeTreeProps<T>) =>
  nodes.map((node) => {
    if (node.kind === "file")
      return <Fragment key={node.key}>{renderFile(node.item, depth)}</Fragment>;
    const open = !collapsed.has(node.key);
    return (
      <Fragment key={node.key}>
        <FolderRow folder={node} depth={depth} open={open} onToggle={() => onToggle(node.key)} />
        {open && (
          <ChangeTree
            nodes={node.children}
            depth={depth + 1}
            collapsed={collapsed}
            onToggle={onToggle}
            renderFile={renderFile}
          />
        )}
      </Fragment>
    );
  });

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

type Changes = Awaited<ReturnType<typeof loadChanges>>;

const SessionChanges = memo(
  ({
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
    const [collapsed, toggleFolder] = useCollapsed();
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
        <ChangeTree
          nodes={tree}
          collapsed={collapsed}
          onToggle={toggleFolder}
          renderFile={(file, depth) => (
            <Row
              path={file.path}
              depth={depth}
              badge={STATUS_BADGE[file.status]}
              onOpen={() => openDiff(file)}
            >
              <span className="shrink-0 font-mono text-[10.5px]">
                {file.additions > 0 && <span className="text-add">+{file.additions}</span>}
                {file.deletions > 0 && <span className="ml-1 text-del">−{file.deletions}</span>}
              </span>
            </Row>
          )}
        />
      </CollapsibleSection>
    );
  },
);
SessionChanges.displayName = "SessionChanges";

const RepoChanges = memo(
  ({ workspace, git, error }: { workspace: Workspace; git: GitChange[]; error: string | null }) => {
    const [open, setOpen] = useState(true);
    const [collapsed, toggleFolder] = useCollapsed();
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
            <Row
              path={change.path}
              depth={depth}
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
          )}
        />
      </CollapsibleSection>
    );
  },
);
RepoChanges.displayName = "RepoChanges";

const WorkspaceChanges = ({ workspace }: { workspace: Workspace }) => {
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
