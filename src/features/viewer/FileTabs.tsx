import { useEffect, useRef } from "react";
import { ArrowRightToLine, Copy, FolderOpen, GitCompare, Plug, X, XCircle } from "lucide-react";
import { toast } from "sonner";

import { closeFilesWithConfirm, closeFileWithConfirm } from "@/actions/files";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { decodeDiffTab, decodeMcpTab, tabTargetPath } from "@/lib/diff-tabs";
import { FileIcon } from "@/lib/file-icons";
import { DECK_PATH_MIME } from "@/lib/terminal/input";
import { copyText, revealInExplorer } from "@/lib/tauri/system";
import { basename, cn, normalizePath, relativePath, samePath } from "@/lib/utils";
import { useViewerStore } from "@/stores/viewer-store";
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
  const saved = () => tabs.filter((t) => !(normalizePath(t) in useViewerStore.getState().drafts));

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
            <ContextMenuItem
              icon={<Copy />}
              onSelect={() => void copyText(path).then(() => toast.success("Path copied"))}
            >
              Copy path
            </ContextMenuItem>
            <ContextMenuItem
              icon={<Copy />}
              onSelect={() =>
                void copyText(relativePath(path, workspace.cwd)).then(() =>
                  toast.success("Relative path copied"),
                )
              }
            >
              Copy relative path
            </ContextMenuItem>
            <ContextMenuItem icon={<FolderOpen />} onSelect={() => void revealInExplorer(path)}>
              Reveal in File Explorer
            </ContextMenuItem>
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
      <div
        ref={ref}
        role="tab"
        tabIndex={0}
        aria-selected={active}
        title={isMcp ? `MCP server ${label}` : target}
        draggable={!isMcp}
        onDragStart={(e) => e.dataTransfer.setData(DECK_PATH_MIME, target)}
        onClick={() => useWorkspaceStore.getState().setActiveFile(workspace.id, tab)}
        onMouseDown={(e) => e.button === 1 && e.preventDefault()}
        onAuxClick={(e) => e.button === 1 && void closeFileWithConfirm(workspace.id, tab)}
        className={cn(
          "group relative flex max-w-[200px] shrink-0 cursor-default items-center gap-1.5 border-r border-border pr-1 pl-2.5 text-[12px]",
          active ? "bg-bg text-fg" : "text-muted hover:text-fg",
        )}
      >
        {active && <span className="absolute inset-x-0 top-0 h-px bg-accent" />}
        {isMcp ? <Plug className="size-3.5 shrink-0 text-info" /> : <FileIcon path={target} />}
        <span className="truncate">{label}</span>
        {isDiff && <GitCompare className="size-3 shrink-0 text-faint" />}
        <button
          type="button"
          aria-label={`Close ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            void closeFileWithConfirm(workspace.id, tab);
          }}
          className="flex size-5 items-center justify-center rounded text-faint hover:bg-active hover:text-fg"
        >
          {dirty && <span className="size-2 rounded-full bg-fg/70 group-hover:hidden" />}
          <X
            className={cn(
              "size-3",
              dirty && "hidden group-hover:block",
              !active && !dirty && "opacity-0 group-hover:opacity-100",
            )}
          />
        </button>
      </div>
    </TabMenu>
  );
};

export const FileTabs = ({ workspace }: { workspace: Workspace }) => (
  <div
    role="tablist"
    onWheel={(e) => {
      if (e.deltaY) e.currentTarget.scrollLeft += e.deltaY;
    }}
    className="no-scrollbar flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-panel"
  >
    {workspace.openFiles.map((tab) => (
      <FileTab key={tab} workspace={workspace} tab={tab} />
    ))}
  </div>
);
