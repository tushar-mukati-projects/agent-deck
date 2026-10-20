import { useDeferredValue, useState } from "react";

import { PreviewHeader } from "@/features/workspace/PreviewHeader";
import { TranscriptList } from "@/features/workspace/TranscriptList";
import { useTranscript } from "@/features/workspace/useTranscript";
import { useAsync } from "@/hooks/useAsync";
import { useSessionFile } from "@/hooks/useSessionFile";
import { api } from "@/lib/tauri/commands";
import { findAgent } from "@/stores/agents";
import { useSessionsStore } from "@/stores/sessions-store";
import type { Workspace } from "@/types";

type SessionPreviewProps = {
  workspace: Workspace;
};

export const SessionPreview = ({ workspace }: SessionPreviewProps) => {
  const session = useSessionsStore((s) => s.byId[workspace.sessionId]);
  const sessionsLoaded = useSessionsStore((s) => s.loaded);
  const { filePath, distro } = useSessionFile(workspace);
  const { items, error } = useTranscript(
    filePath,
    distro,
    session?.modifiedMs ?? 0,
    sessionsLoaded,
  );
  const { data: isFolder = true, error: folderError } = useAsync(
    () => api.statPath(workspace.cwd).then((stat) => stat?.kind === "dir"),
    [workspace.cwd],
    { keepPrevious: true },
  );
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PreviewHeader
        workspace={workspace}
        session={session}
        folderExists={isFolder && !folderError}
        folderError={folderError}
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
        workspaceId={workspace.id}
      />
    </div>
  );
};
