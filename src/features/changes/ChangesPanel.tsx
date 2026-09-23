import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Eye, EyeOff, GitCompare, RefreshCw } from "lucide-react";

import { EmptyState, Spinner } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { encodeDiffTab } from "@/lib/diff-tabs";
import { subscribeFileChanges } from "@/lib/file-events";
import { FileIcon } from "@/lib/file-icons";
import { api } from "@/lib/tauri/commands";
import { basename, cn, dirname, errorMessage, isWithin, relativePath } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useActiveWorkspace, useWorkspaceStore, type WorkspaceRecord } from "@/stores/workspace-store";
import type { ChangedFile, GitChange } from "@/types";

const statusBadge: Record<string, { letter: string; className: string; label: string }> = {
  added: { letter: "A", className: "text-add", label: "Added" },
  modified: { letter: "M", className: "text-mod", label: "Modified" },
  deleted: { letter: "D", className: "text-del", label: "Deleted" },
  unchanged: { letter: "·", className: "text-faint", label: "Changed, then restored" },
};

const gitBadge = (code: string) => {
  if (code === "??" || code.includes("A")) return statusBadge.added;
  if (code.includes("D")) return statusBadge.deleted;
  return statusBadge.modified;
};

const useDebounced = (callback: () => void, delay: number) => {
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(callback);
  latest.current = callback;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => latest.current(), delay);
  }, [delay]);
};

const Row = ({
  workspace,
  path,
  badge,
  onOpen,
  children,
}: {
  workspace: WorkspaceRecord;
  path: string;
  badge: { letter: string; className: string; label: string };
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
      className="group flex h-[26px] w-full items-center gap-2 rounded-md px-2 text-left text-[12px] hover:bg-hover"
    >
      <FileIcon path={path} />
      <span className="shrink-0 truncate text-fg/90">{basename(path)}</span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{folder}</span>
      {children}
      <span title={badge.label} className={cn("w-3 shrink-0 text-center font-mono text-[11px] font-semibold", badge.className)}>
        {badge.letter}
      </span>
    </button>
  );
};

const Section = ({
  title,
  count,
  summary,
  children,
}: {
  title: string;
  count: number;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) => {
  const [open, setOpen] = useState(true);
  return (
    <section className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-7 w-full items-center gap-1.5 px-2 text-[11px] font-semibold tracking-wide text-muted hover:text-fg"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        <span className="truncate">{title}</span>
        <span className="font-normal text-faint">{count}</span>
        <span className="ml-auto font-mono font-normal">{summary}</span>
      </button>
      {open && <div className="flex flex-col px-1">{children}</div>}
    </section>
  );
};

export const ChangesPanel = () => {
  const workspace = useActiveWorkspace();
  const session = useSessionsStore((s) => (workspace ? s.byId[workspace.sessionId] : undefined));
  const openFile = useWorkspaceStore((s) => s.openFile);
  const [files, setFiles] = useState<ChangedFile[] | null>(null);
  const [git, setGit] = useState<GitChange[] | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showUnchanged, setShowUnchanged] = useState(false);

  const load = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    const [changes, status] = await Promise.allSettled([
      session ? api.sessionChanges(session.filePath, session.distro) : Promise.resolve([]),
      api.gitStatus(workspace.cwd),
    ]);
    setFiles(changes.status === "fulfilled" ? changes.value : []);
    setError(changes.status === "rejected" ? errorMessage(changes.reason) : null);
    setGit(status.status === "fulfilled" ? status.value : []);
    setGitError(status.status === "rejected" ? errorMessage(status.reason) : null);
    setLoading(false);
  }, [workspace, session]);

  const reload = useDebounced(() => void load(), 900);

  useEffect(() => {
    setFiles(null);
    setGit(null);
    void load();
  }, [workspace?.id]);

  useEffect(() => {
    if (session?.modifiedMs) reload();
  }, [session?.modifiedMs, reload]);

  const cwd = workspace?.cwd;
  useEffect(() => {
    if (!cwd) return;
    return subscribeFileChanges((change) => {
      if (change.paths.some((p) => isWithin(p, cwd))) reload();
    });
  }, [cwd, reload]);

  const visibleFiles = useMemo(
    () => (files ?? []).filter((f) => showUnchanged || f.status !== "unchanged"),
    [files, showUnchanged],
  );
  const totals = useMemo(
    () => visibleFiles.reduce((acc, f) => ({ add: acc.add + f.additions, del: acc.del + f.deletions }), { add: 0, del: 0 }),
    [visibleFiles],
  );

  if (!workspace) {
    return (
      <EmptyState
        className="h-full"
        icon={<GitCompare />}
        title="No session open"
        description="Open a session to see which files Claude changed."
      />
    );
  }

  const openDiff = (path: string, source: "session" | "git", backup: string | null) =>
    openFile(workspace.id, encodeDiffTab({ source, path, backup }));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between pr-2 pl-3.5">
        <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">Changes</span>
        <div className="flex items-center gap-0.5">
          <IconButton
            label={showUnchanged ? "Hide restored files" : "Show restored files"}
            onClick={() => setShowUnchanged((v) => !v)}
          >
            {showUnchanged ? <Eye /> : <EyeOff />}
          </IconButton>
          <IconButton label="Refresh" onClick={() => void load()}>
            <RefreshCw className={cn(loading && "animate-spin")} />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {files === null ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : (
          <>
            <Section
              title="Edited in this session"
              count={visibleFiles.length}
              summary={
                visibleFiles.length > 0 && (
                  <>
                    <span className="text-add">+{totals.add}</span>{" "}
                    <span className="text-del">−{totals.del}</span>
                  </>
                )
              }
            >
              {error && <p className="px-2 py-1 text-[11px] text-danger">{error}</p>}
              {visibleFiles.length === 0 && !error && (
                <p className="px-2 py-1 text-[11.5px] text-faint">Claude hasn't changed any files in this session.</p>
              )}
              {visibleFiles.map((file) => (
                <Row
                  key={file.path}
                  workspace={workspace}
                  path={file.path}
                  badge={statusBadge[file.status] ?? statusBadge.modified}
                  onOpen={() => openDiff(file.path, "session", file.backup)}
                >
                  <span className="shrink-0 font-mono text-[10.5px]">
                    {file.additions > 0 && <span className="text-add">+{file.additions}</span>}
                    {file.deletions > 0 && <span className="ml-1 text-del">−{file.deletions}</span>}
                  </span>
                </Row>
              ))}
            </Section>

            <Section title="Uncommitted in repo" count={git?.length ?? 0}>
              {gitError && <p className="px-2 py-1 text-[11px] text-faint">Not a git repository.</p>}
              {!gitError && git?.length === 0 && <p className="px-2 py-1 text-[11.5px] text-faint">Working tree is clean.</p>}
              {(git ?? []).map((change) => (
                <Row
                  key={change.path}
                  workspace={workspace}
                  path={change.path}
                  badge={gitBadge(change.code)}
                  onOpen={() => openDiff(change.path, "git", null)}
                />
              ))}
            </Section>
          </>
        )}
      </div>
    </div>
  );
};
