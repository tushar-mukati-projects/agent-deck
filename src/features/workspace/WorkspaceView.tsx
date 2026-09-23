import { useEffect } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";

import { ClaudePane } from "@/features/workspace/ClaudePane";
import { SessionPreview } from "@/features/workspace/SessionPreview";
import { ShellPanel } from "@/features/workspace/ShellPanel";
import { FileViewer } from "@/features/viewer/FileViewer";
import { releaseWatch, retainWatch } from "@/lib/file-events";
import { api } from "@/lib/tauri/commands";
import { cn } from "@/lib/utils";
import type { WorkspaceRecord } from "@/stores/workspace-store";

export const ResizeHandle = ({ orientation }: { orientation: "horizontal" | "vertical" }) => (
  <Separator
    className={cn(
      "relative shrink-0 bg-border transition-colors duration-150 data-[separator=active]:bg-accent data-[separator=hover]:bg-accent/60",
      orientation === "horizontal" ? "w-px" : "h-px",
    )}
  />
);

export const WorkspaceView = ({ workspace }: { workspace: WorkspaceRecord }) => {
  const hasFiles = workspace.openFiles.length > 0;
  const shellOpen = workspace.shellPanelOpen && workspace.shells.length > 0;

  useEffect(() => {
    retainWatch(workspace.cwd, api.watchDir);
    return () => releaseWatch(workspace.cwd, api.unwatchDir);
  }, [workspace.cwd]);

  return (
    <Group orientation="horizontal" className="h-full">
      <Panel id="main" minSize={360}>
        <Group orientation="vertical" className="h-full">
          <Panel id="primary" minSize={140}>
            {workspace.mode === "live" ? <ClaudePane workspace={workspace} /> : <SessionPreview workspace={workspace} />}
          </Panel>
          {shellOpen && (
            <>
              <ResizeHandle orientation="vertical" />
              <Panel id="shell" defaultSize="34%" minSize={110}>
                <ShellPanel workspace={workspace} />
              </Panel>
            </>
          )}
        </Group>
      </Panel>
      {hasFiles && (
        <>
          <ResizeHandle orientation="horizontal" />
          <Panel id="viewer" defaultSize="46%" minSize={320}>
            <FileViewer workspace={workspace} />
          </Panel>
        </>
      )}
    </Group>
  );
};
