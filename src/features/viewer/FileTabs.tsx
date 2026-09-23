import { useEffect, useRef } from "react";
import { GitCompare, Images, X } from "lucide-react";

import { closeFileWithConfirm } from "@/actions/files";
import { decodeDiffTab, decodeMediaTab, tabTargetPath } from "@/lib/diff-tabs";
import { FileIcon } from "@/lib/file-icons";
import { DECK_PATH_MIME } from "@/lib/terminal/input";
import { basename, cn, normalizePath, samePath } from "@/lib/utils";
import { useViewerStore } from "@/stores/viewer-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

const TabIcon = ({ tab }: { tab: string }) => {
  if (decodeMediaTab(tab))
    return <Images className="size-3.5 shrink-0 text-[var(--icon-purple)]" />;
  return <FileIcon path={tabTargetPath(tab)} />;
};

const tabLabel = (tab: string) =>
  decodeMediaTab(tab) !== null ? "Media" : basename(tabTargetPath(tab));

const FileTab = ({ workspace, tab }: { workspace: Workspace; tab: string }) => {
  const active = !!workspace.activeFile && samePath(tab, workspace.activeFile);
  const dirty = useViewerStore((s) => normalizePath(tab) in s.drafts);
  const ref = useRef<HTMLDivElement>(null);
  const isDiff = !!decodeDiffTab(tab);
  const target = tabTargetPath(tab);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);

  return (
    <div
      ref={ref}
      role="tab"
      tabIndex={0}
      aria-selected={active}
      title={target}
      draggable={!decodeMediaTab(tab)}
      onDragStart={(e) => e.dataTransfer.setData(DECK_PATH_MIME, target)}
      onClick={() => useWorkspaceStore.getState().setActiveFile(workspace.id, tab)}
      onAuxClick={(e) => e.button === 1 && void closeFileWithConfirm(workspace.id, tab)}
      className={cn(
        "group relative flex max-w-[200px] shrink-0 cursor-default items-center gap-1.5 border-r border-border pr-1 pl-2.5 text-[12px]",
        active ? "bg-bg text-fg" : "text-muted hover:text-fg",
      )}
    >
      {active && <span className="absolute inset-x-0 top-0 h-px bg-accent" />}
      <TabIcon tab={tab} />
      <span className="truncate">{tabLabel(tab)}</span>
      {isDiff && <GitCompare className="size-3 shrink-0 text-faint" />}
      <button
        type="button"
        aria-label={`Close ${tabLabel(tab)}`}
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
