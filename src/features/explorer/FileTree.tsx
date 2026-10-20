import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Chevron } from "@/components/ui/chevron";
import { FileRowMenu } from "@/features/explorer/FileRowMenu";
import { TreeGuides, treeIndent } from "@/features/explorer/TreeGuides";
import { fileIcon, folderIcon } from "@/lib/file-icons";
import { DECK_PATH_MIME } from "@/lib/terminal/input";
import { treeKeyAction } from "@/lib/tree-keys";
import { cn, normalizePath } from "@/lib/utils";
import { useExplorerStore } from "@/stores/explorer-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { DirEntry, Workspace } from "@/types";

const ROW_HEIGHT = 22;
const OVERSCAN = 12;
const SCROLL_STEP = ROW_HEIGHT * 6;

interface Row {
  entry: DirEntry;
  key: string;
  depth: number;
  expanded: boolean;
}

const useRows = (root: string) => {
  const children = useExplorerStore((s) => s.children);
  const expanded = useExplorerStore((s) => s.expanded);
  const showHidden = useSettingsStore((s) => s.showHidden);

  return useMemo(() => {
    const rows: Row[] = [];
    const walk = (dir: string, depth: number) => {
      for (const entry of children[normalizePath(dir)] ?? []) {
        if (!showHidden && entry.hidden) continue;
        const key = normalizePath(entry.path);
        const isExpanded = entry.isDir && !!expanded[key];
        rows.push({ entry, key, depth, expanded: isExpanded });
        if (isExpanded) walk(entry.path, depth + 1);
      }
    };
    walk(root, 0);
    return rows;
  }, [children, expanded, showHidden, root]);
};

type FileTreeProps = {
  workspace: Workspace;
};

export const FileTree = ({ workspace }: FileTreeProps) => {
  const root = workspace.cwd;
  const rows = useRows(root);
  const selected = useExplorerStore((s) => s.selected);
  const loading = useExplorerStore((s) => s.loading);
  const { toggle, expand, collapse, select } = useExplorerStore.getState();
  const openFile = useWorkspaceStore((s) => s.openFile);
  const activeFile = workspace.activeFile;
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setViewport((v) => ({ ...v, height: element.clientHeight })),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const selectedIndex = useMemo(() => {
    if (!selected) return -1;
    const key = normalizePath(selected);
    return rows.findIndex((r) => r.key === key);
  }, [rows, selected]);
  const activeKey = activeFile ? normalizePath(activeFile) : null;

  useEffect(() => {
    const element = containerRef.current;
    if (!element || selectedIndex < 0) return;
    const top = selectedIndex * ROW_HEIGHT;
    const viewTop = element.scrollTop;
    const viewBottom = viewTop + element.clientHeight;
    if (top >= viewTop && top + ROW_HEIGHT <= viewBottom) return;
    const adjacent = top >= viewTop - ROW_HEIGHT && top + ROW_HEIGHT <= viewBottom + ROW_HEIGHT;
    if (!adjacent) element.scrollTop = top - element.clientHeight / 2 + ROW_HEIGHT / 2;
    else if (top < viewTop) element.scrollTop = top;
    else element.scrollTop = top + ROW_HEIGHT - element.clientHeight;
  }, [selectedIndex]);

  const activate = (row: Row) => {
    select(row.entry.path);
    if (row.entry.isDir) toggle(row.entry.path);
    else openFile(workspace.id, row.entry.path);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    const action = treeKeyAction(rows, selectedIndex, event.key);
    if (!action) return;
    event.preventDefault();
    const current = rows[selectedIndex];
    if (action.kind === "select") select(rows[action.index].entry.path);
    else if (current && action.kind === "expand") expand(current.entry.path);
    else if (current && action.kind === "collapse") collapse(current.entry.path);
    else if (current && action.kind === "activate") activate(current);
  };

  const start = Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    rows.length,
    Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN,
  );

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label="Files"
      aria-activedescendant={selectedIndex >= 0 ? `tree-row-${selectedIndex}` : undefined}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onScroll={(e) => {
        const top = Math.floor(e.currentTarget.scrollTop / SCROLL_STEP) * SCROLL_STEP;
        setViewport((v) => (v.top === top ? v : { ...v, top }));
      }}
      className="relative min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-accent/60 focus-visible:ring-inset"
    >
      <div style={{ height: rows.length * ROW_HEIGHT }} className="relative">
        {rows.slice(start, end).map((row, offset) => {
          const index = start + offset;
          const { entry } = row;
          const isSelected = index === selectedIndex;
          const isOpenFile = activeKey === row.key;
          const spec = entry.isDir ? folderIcon(entry.name, row.expanded) : fileIcon(entry.path);
          const Icon = spec.icon;
          const isLoading = entry.isDir && loading[row.key];
          return (
            <FileRowMenu key={entry.path} entry={entry} workspace={workspace}>
              <div
                id={`tree-row-${index}`}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={entry.isDir ? row.expanded : undefined}
                aria-selected={isSelected}
                draggable
                onDragStart={(e) => e.dataTransfer.setData(DECK_PATH_MIME, entry.path)}
                onClick={() => activate(row)}
                onContextMenu={() => select(entry.path)}
                style={{
                  top: index * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                  paddingLeft: treeIndent(row.depth),
                }}
                className={cn(
                  "absolute inset-x-0 flex cursor-default items-center gap-1.5 pr-2 text-[12.5px]",
                  isSelected
                    ? "bg-active text-fg"
                    : isOpenFile
                      ? "bg-hover text-fg"
                      : "text-fg/85 hover:bg-hover/70",
                  entry.hidden && "opacity-60",
                )}
              >
                <TreeGuides depth={row.depth} />
                <span className="flex w-3 shrink-0 justify-center">
                  {entry.isDir && (
                    <Chevron
                      open={row.expanded}
                      className={cn("text-faint", isLoading && "animate-pulse")}
                    />
                  )}
                </span>
                <Icon className={cn("size-3.5 shrink-0", spec.color)} />
                <span className="min-w-0 truncate">{entry.name}</span>
                {entry.isSymlink && <span className="text-[10px] text-faint">↗</span>}
              </div>
            </FileRowMenu>
          );
        })}
      </div>
    </div>
  );
};
