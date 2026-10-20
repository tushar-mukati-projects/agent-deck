import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, GitCompare, RefreshCw } from "lucide-react";

import { EmptyState, LoadingState } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { PanelHeader } from "@/components/ui/panel-header";
import { RepoChanges, SessionChanges } from "@/features/changes/ChangeSections";
import { useAsync, useThrottledCallback } from "@/hooks/useAsync";
import { useSessionFile } from "@/hooks/useSessionFile";
import { subscribeFileChanges } from "@/lib/file-events";
import { api } from "@/lib/tauri/commands";
import { basename, cn, errorMessage, isWithin, sameJson } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useActiveWorkspace } from "@/stores/workspace-store";
import type { ChangedFile, Workspace } from "@/types";

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
