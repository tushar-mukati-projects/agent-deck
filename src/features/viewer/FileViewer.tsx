import { useEffect, useMemo } from "react";
import { FileWarning } from "lucide-react";

import { closeFilesWithConfirm } from "@/actions/files";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { DiffView } from "@/features/changes/DiffView";
import { McpView } from "@/features/mcp/McpView";
import { DocumentView } from "@/features/viewer/DocumentView";
import { FileTabs } from "@/features/viewer/FileTabs";
import { decodeDiffTab, decodeMcpTab } from "@/lib/diff-tabs";
import { samePath } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

type TabBoundaryProps = {
  workspace: Workspace;
  tab: string;
  children: React.ReactNode;
};

const TabBoundary = ({ workspace, tab, children }: TabBoundaryProps) => (
  <ErrorBoundary
    key={tab}
    fallback={(error, reset) => (
      <EmptyState
        className="h-full"
        icon={<FileWarning />}
        title="This tab ran into a problem"
        description={error.message}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={reset}>
              Try again
            </Button>
            <Button size="sm" onClick={() => void closeFilesWithConfirm(workspace.id, [tab])}>
              Close tab
            </Button>
          </div>
        }
      />
    )}
  >
    {children}
  </ErrorBoundary>
);

type FileBodyProps = {
  workspace: Workspace;
  tab: string;
};

const FileBody = ({ workspace, tab }: FileBodyProps) => {
  const diff = useMemo(() => decodeDiffTab(tab), [tab]);
  if (diff) return <DiffView tab={diff} workspace={workspace} />;
  return <DocumentView workspace={workspace} path={tab} />;
};

type FileViewerProps = {
  workspace: Workspace;
};

export const FileViewer = ({ workspace }: FileViewerProps) => {
  const activeFile = workspace.activeFile ?? workspace.openFiles[0];
  const serverTabs = workspace.openFiles.flatMap((tab) => {
    const serverId = decodeMcpTab(tab);
    return serverId === null ? [] : [{ tab, serverId }];
  });
  const activeIsServer = !!activeFile && decodeMcpTab(activeFile) !== null;

  useEffect(() => {
    if (!workspace.activeFile && activeFile)
      useWorkspaceStore.getState().setActiveFile(workspace.id, activeFile);
  }, [workspace.id, workspace.activeFile, activeFile]);

  if (!activeFile) return null;
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <FileTabs workspace={workspace} />
      {serverTabs.map(({ tab, serverId }) => (
        <div
          key={tab}
          className={samePath(tab, activeFile) ? "flex min-h-0 flex-1 flex-col" : "hidden"}
        >
          <TabBoundary workspace={workspace} tab={tab}>
            <McpView workspace={workspace} serverId={serverId} />
          </TabBoundary>
        </div>
      ))}
      {!activeIsServer && (
        <TabBoundary workspace={workspace} tab={activeFile}>
          <FileBody key={activeFile} workspace={workspace} tab={activeFile} />
        </TabBoundary>
      )}
    </div>
  );
};
