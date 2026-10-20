import { useEffect, useRef } from "react";
import { ArrowRightToLine, GitCompare, Plug, X, XCircle } from "lucide-react";

import { closeFilesWithConfirm } from "@/actions/files";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { Tab, TabStrip } from "@/components/ui/tabs";
import { fileActions } from "@/features/viewer/file-actions";
import { decodeDiffTab, decodeMcpTab, tabTargetPath } from "@/lib/diff-tabs";
import { FileIcon } from "@/lib/file-icons";
import { DECK_PATH_MIME } from "@/lib/terminal/input";
import { basename, cn, normalizePath, samePath } from "@/lib/utils";
import { isDirty, useViewerStore } from "@/stores/viewer-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

const mcpName = (serverId: string) => serverId.split(":").at(-1) ?? serverId;

const tabLabel = (tab: string) => {
  const server = decodeMcpTab(tab);
  return server !== null ? mcpName(server) : basename(tabTargetPath(tab));
};

const TabMenu = ({
  workspace,
  tab,
  children,
}: {
  workspace: Workspace;
  tab: string;
  children: React.ReactNode;
}) => {
  const tabs = workspace.openFiles;
  const index = tabs.findIndex((t) => samePath(t, tab));
  const isFile = decodeMcpTab(tab) === null;
  const path = tabTargetPath(tab);
  const close = (list: string[]) => void closeFilesWithConfirm(workspace.id, list);
  const saved = () => tabs.filter((t) => !isDirty(t));

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon={<X />} shortcut="Ctrl Shift W" onSelect={() => close([tab])}>
          Close
        </ContextMenuItem>
        <ContextMenuItem
          icon={<XCircle />}
          disabled={tabs.length < 2}
          onSelect={() => close(tabs.filter((_, i) => i !== index))}
        >
          Close others
        </ContextMenuItem>
        <ContextMenuItem
          icon={<ArrowRightToLine />}
          disabled={index >= tabs.length - 1}
          onSelect={() => close(tabs.slice(index + 1))}
        >
          Close to the right
        </ContextMenuItem>
        <ContextMenuItem icon={<XCircle />} onSelect={() => close(saved())}>
          Close saved
        </ContextMenuItem>
        <ContextMenuItem icon={<XCircle />} onSelect={() => close(tabs)}>
          Close all
        </ContextMenuItem>
        {isFile && (
          <>
            <ContextMenuSeparator />
            {fileActions(path, workspace.cwd, false).map(({ label, icon, run }) => (
              <ContextMenuItem key={label} icon={icon} onSelect={run}>
                {label}
              </ContextMenuItem>
            ))}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
};

const FileTab = ({ workspace, tab }: { workspace: Workspace; tab: string }) => {
  const active = !!workspace.activeFile && samePath(tab, workspace.activeFile);
  const dirty = useViewerStore((s) => normalizePath(tab) in s.drafts);
  const ref = useRef<HTMLDivElement>(null);
  const isDiff = !!decodeDiffTab(tab);
  const isMcp = decodeMcpTab(tab) !== null;
  const target = tabTargetPath(tab);
  const label = tabLabel(tab);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <TabMenu workspace={workspace} tab={tab}>
      <Tab
        ref={ref}
        selected={active}
        onSelect={() => useWorkspaceStore.getState().setActiveFile(workspace.id, tab)}
        onClose={() => void closeFilesWithConfirm(workspace.id, [tab])}
        closeLabel={dirty ? `Close ${label} (unsaved changes)` : `Close ${label}`}
        closeIcon={
          dirty ? (
            <>
              <span className="size-2 rounded-full bg-fg/70 group-hover:hidden" />
              <X className="hidden size-3 group-hover:block" />
            </>
          ) : undefined
        }
        title={isMcp ? `MCP server ${label}` : target}
        draggable={!isMcp}
        onDragStart={(e) => e.dataTransfer.setData(DECK_PATH_MIME, target)}
        className={cn(
          "max-w-[200px] cursor-default border-r border-border pr-1 pl-2.5 text-[12px]",
          active ? "bg-bg text-fg" : "text-muted hover:text-fg",
        )}
      >
        {active && <span className="absolute inset-x-0 top-0 h-px bg-accent" />}
        {isMcp ? <Plug className="size-3.5 shrink-0 text-info" /> : <FileIcon path={target} />}
        <span className="truncate">{label}</span>
        {isDiff && <GitCompare className="size-3 shrink-0 text-faint" />}
      </Tab>
    </TabMenu>
  );
};

export const FileTabs = ({ workspace }: { workspace: Workspace }) => (
  <TabStrip
    label="Open files"
    className="h-9 shrink-0 items-stretch border-b border-border bg-panel"
  >
    {workspace.openFiles.map((tab) => (
      <FileTab key={tab} workspace={workspace} tab={tab} />
    ))}
  </TabStrip>
);
