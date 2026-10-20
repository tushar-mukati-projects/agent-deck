import { useEffect, useRef } from "react";
import { Group, Panel, useDefaultLayout } from "react-resizable-panels";

import { ResizeHandle } from "@/components/ui/resize-handle";
import { AgentPane } from "@/features/workspace/AgentPane";
import { SessionPreview } from "@/features/workspace/SessionPreview";
import { ShellPanel } from "@/features/workspace/ShellPanel";
import { SubagentsPanel } from "@/features/workspace/SubagentsPanel";
import { FileViewer } from "@/features/viewer/FileViewer";
import { useAgentShells, useAgentShellSync, useSubagents } from "@/hooks/useAgentShells";
import { releaseWatch, retainWatch } from "@/lib/file-events";
import { api } from "@/lib/tauri/commands";
import { useExplorerStore } from "@/stores/explorer-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

const MAIN_MIN_PX = 280;
const PRIMARY_MIN_PX = 120;
const SIDE_PANE_MIN_PX = 100;
const SIDE_PANE_DEFAULT = "34%";
const VIEWER_MIN_PX = 240;
const VIEWER_DEFAULT = "46%";

const useSavedLayout = (id: string, panelIds: string[]) =>
  useDefaultLayout({ id, panelIds, onlySaveAfterUserInteractions: true });

const useWatchedRoot = (root: string) =>
  useEffect(() => {
    const fresh = retainWatch(root, api.watchDir);
    if (fresh) useExplorerStore.getState().refreshWithin(root);
    return () => releaseWatch(root, api.unwatchDir);
  }, [root]);

type WorkspaceLayoutProps = {
  workspace: Workspace;
};

const WorkspaceLayout = ({ workspace }: WorkspaceLayoutProps) => {
  const hasFiles = workspace.openFiles.length > 0;
  const agentShells = useAgentShells(workspace);
  const shellOpen =
    workspace.shellPanelOpen && (workspace.shells.length > 0 || agentShells.length > 0);
  const shellEmptied = workspace.shellPanelOpen && !shellOpen;
  useEffect(() => {
    if (shellEmptied) useWorkspaceStore.getState().collapseShellPanel(workspace.id);
  }, [shellEmptied, workspace.id]);
  const subagents = useSubagents(workspace);
  const subagentsOpen = useUiStore((s) => s.subagentsOpen) && subagents.length > 0;
  const runningBefore = useRef(subagents.length);
  useEffect(() => {
    if (runningBefore.current > 0 && subagents.length === 0)
      useUiStore.getState().setSubagentsOpen(false);
    runningBefore.current = subagents.length;
  }, [subagents.length]);
  const columns = useSavedLayout("deck-columns", hasFiles ? ["main", "viewer"] : ["main"]);
  const rows = useSavedLayout("deck-rows", [
    "primary",
    ...(shellOpen ? ["shell"] : []),
    ...(subagentsOpen ? ["subagents"] : []),
  ]);
  useWatchedRoot(workspace.cwd);

  return (
    <Group
      orientation="horizontal"
      className="animate-fade-in h-full"
      defaultLayout={columns.defaultLayout}
      onLayoutChanged={columns.onLayoutChanged}
    >
      <Panel id="main" minSize={MAIN_MIN_PX}>
        <Group
          orientation="vertical"
          className="h-full"
          defaultLayout={rows.defaultLayout}
          onLayoutChanged={rows.onLayoutChanged}
        >
          <Panel id="primary" minSize={PRIMARY_MIN_PX}>
            {workspace.mode === "live" ? (
              <AgentPane workspace={workspace} />
            ) : (
              <SessionPreview workspace={workspace} />
            )}
          </Panel>
          {shellOpen && (
            <>
              <ResizeHandle orientation="vertical" />
              <Panel id="shell" defaultSize={SIDE_PANE_DEFAULT} minSize={SIDE_PANE_MIN_PX}>
                <ShellPanel workspace={workspace} />
              </Panel>
            </>
          )}
          {subagentsOpen && (
            <>
              <ResizeHandle orientation="vertical" />
              <Panel id="subagents" defaultSize={SIDE_PANE_DEFAULT} minSize={SIDE_PANE_MIN_PX}>
                <SubagentsPanel workspace={workspace} agents={subagents} />
              </Panel>
            </>
          )}
        </Group>
      </Panel>
      {hasFiles && (
        <>
          <ResizeHandle orientation="horizontal" />
          <Panel id="viewer" defaultSize={VIEWER_DEFAULT} minSize={VIEWER_MIN_PX}>
            <FileViewer workspace={workspace} />
          </Panel>
        </>
      )}
    </Group>
  );
};

type AgentShellSyncProps = {
  workspace: Workspace;
};

const AgentShellSync = ({ workspace }: AgentShellSyncProps) => {
  useAgentShellSync(workspace);
  return null;
};

type WorkspaceViewProps = {
  workspaceId: string;
};

export const WorkspaceView = ({ workspaceId }: WorkspaceViewProps) => {
  const workspace = useWorkspace(workspaceId);
  return workspace ? (
    <>
      <AgentShellSync workspace={workspace} />
      <WorkspaceLayout workspace={workspace} />
    </>
  ) : null;
};
