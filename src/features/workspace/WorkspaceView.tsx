import { useEffect } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";

import { AgentPane } from "@/features/workspace/AgentPane";
import { SessionPreview } from "@/features/workspace/SessionPreview";
import { ShellPanel } from "@/features/workspace/ShellPanel";
import { FileViewer } from "@/features/viewer/FileViewer";
import { releaseWatch, retainWatch } from "@/lib/file-events";
import { api } from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";
import { useExplorerStore } from "@/stores/explorer-store";
import { useWorkspace } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

export const ResizeHandle = ({ orientation }: { orientation: "horizontal" | "vertical" }) => (
  <Separator
    className={cn(
      "relative shrink-0 bg-border transition-colors duration-150 data-[separator=active]:bg-accent data-[separator=hover]:bg-accent/60",
      orientation === "horizontal" ? "w-px" : "h-px",
    )}
  />
);

const useSavedLayout = (id: string, panelIds: string[]) =>
  useDefaultLayout({ id, panelIds, onlySaveAfterUserInteractions: true });

const useWatchedRoot = (root: string) =>
  useEffect(() => {
    const fresh = retainWatch(root, api.watchDir);
    if (fresh) useExplorerStore.getState().refreshWithin(root);
    return () => releaseWatch(root, api.unwatchDir);
  }, [root]);

const WorkspaceLayout = ({ workspace }: { workspace: Workspace }) => {
  const hasFiles = workspace.openFiles.length > 0;
  const shellOpen = workspace.shellPanelOpen && workspace.shells.length > 0;
  const columns = useSavedLayout("deck-columns", hasFiles ? ["main", "viewer"] : ["main"]);
  const rows = useSavedLayout("deck-rows", shellOpen ? ["primary", "shell"] : ["primary"]);
  useWatchedRoot(workspace.cwd);

  return (
    <Group
      orientation="horizontal"
      className="h-full"
      defaultLayout={columns.defaultLayout}
      onLayoutChanged={columns.onLayoutChanged}
    >
      <Panel id="main" minSize={280}>
        <Group
          orientation="vertical"
          className="h-full"
          defaultLayout={rows.defaultLayout}
          onLayoutChanged={rows.onLayoutChanged}
        >
          <Panel id="primary" minSize={120}>
            {workspace.mode === "live" ? (
              <AgentPane workspace={workspace} />
            ) : (
              <SessionPreview workspace={workspace} />
            )}
          </Panel>
          {shellOpen && (
            <>
              <ResizeHandle orientation="vertical" />
              <Panel id="shell" defaultSize="34%" minSize={100}>
                <ShellPanel workspace={workspace} />
              </Panel>
            </>
          )}
        </Group>
      </Panel>
      {hasFiles && (
        <>
          <ResizeHandle orientation="horizontal" />
          <Panel id="viewer" defaultSize="46%" minSize={240}>
            <FileViewer workspace={workspace} />
          </Panel>
        </>
      )}
    </Group>
  );
};

export const WorkspaceView = ({ workspaceId }: { workspaceId: string }) => {
  const workspace = useWorkspace(workspaceId);
  return workspace ? <WorkspaceLayout workspace={workspace} /> : null;
};
