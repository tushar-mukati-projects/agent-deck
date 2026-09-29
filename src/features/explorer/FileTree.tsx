import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  ChevronRight,
  Code2,
  Copy,
  ExternalLink,
  FolderOpen,
  Sparkles,
  SquareTerminal,
} from "lucide-react";
import { toast } from "sonner";

import { canMention, mentionInAgent } from "@/actions/files";
import { startNewSession } from "@/actions/sessions";
import { agentName } from "@/lib/agents/registry";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { fileIcon, folderIcon } from "@/lib/file-icons";
import { api } from "@/lib/tauri/commands";
import { copyText, openExternal, revealInExplorer } from "@/lib/tauri/system";
import { DECK_PATH_MIME } from "@/lib/terminal/input";
import { cn, errorMessage, normalizePath, relativePath } from "@/lib/utils";
import { useExplorerStore } from "@/stores/explorer-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { DirEntry, Workspace } from "@/types";

const showError = (error: unknown) => toast.error(errorMessage(error));

const ROW_HEIGHT = 22;
const OVERSCAN = 12;
const INDENT = 12;

interface Row {
  entry: DirEntry;
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
        const isExpanded = entry.isDir && !!expanded[normalizePath(entry.path)];
        rows.push({ entry, depth, expanded: isExpanded });
        if (isExpanded) walk(entry.path, depth + 1);
      }
    };
    walk(root, 0);
    return rows;
  }, [children, expanded, showHidden, root]);
};

const RowMenu = ({
  row,
  workspace,
  children,
}: {
  row: Row;
  workspace: Workspace;
  children: React.ReactNode;
}) => {
  const { entry } = row;
  const rel = relativePath(entry.path, workspace.cwd);
  const store = useWorkspaceStore.getState;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        {!entry.isDir && (
          <ContextMenuItem
            icon={<Code2 />}
            onSelect={() => store().openFile(workspace.id, entry.path)}
          >
            Open
          </ContextMenuItem>
        )}
        <ContextMenuItem
          icon={<AtSign />}
          disabled={!canMention(workspace)}
          onSelect={() => mentionInAgent(workspace, entry.path)}
        >
          Mention in {agentName(workspace.agent)}
        </ContextMenuItem>
        {entry.isDir && (
          <>
            <ContextMenuItem
              icon={<SquareTerminal />}
              onSelect={() => store().openShell(workspace.id, entry.path)}
            >
              Open shell here
            </ContextMenuItem>
            <ContextMenuItem icon={<Sparkles />} onSelect={() => startNewSession(entry.path)}>
              New session here
            </ContextMenuItem>
          </>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          icon={<Code2 />}
          onSelect={() => void api.openInEditor(entry.path).catch(showError)}
        >
          Open in VS Code
        </ContextMenuItem>
        {!entry.isDir && (
          <ContextMenuItem
            icon={<ExternalLink />}
            onSelect={() => void openExternal(entry.path).catch(showError)}
          >
            Open with default app
          </ContextMenuItem>
        )}
        <ContextMenuItem icon={<FolderOpen />} onSelect={() => void revealInExplorer(entry.path)}>
          Reveal in File Explorer
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<Copy />} onSelect={() => void copyText(entry.path)}>
          Copy path
        </ContextMenuItem>
        <ContextMenuItem icon={<Copy />} onSelect={() => void copyText(rel)}>
          Copy relative path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

export const FileTree = ({ workspace }: { workspace: Workspace }) => {
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
    return rows.findIndex((r) => normalizePath(r.entry.path) === key);
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
    const current = rows[selectedIndex];
    const move = (index: number) => {
      const target = rows[Math.max(0, Math.min(rows.length - 1, index))];
      if (target) select(target.entry.path);
    };
    switch (event.key) {
      case "ArrowDown":
        move(selectedIndex + 1);
        break;
      case "ArrowUp":
        move(selectedIndex < 0 ? 0 : selectedIndex - 1);
        break;
      case "ArrowRight":
        if (current?.entry.isDir && !current.expanded) expand(current.entry.path);
        else move(selectedIndex + 1);
        break;
      case "ArrowLeft":
        if (current?.entry.isDir && current.expanded) collapse(current.entry.path);
        else if (current) {
          const parentIndex = rows
            .slice(0, selectedIndex)
            .findLastIndex((r) => r.depth === current.depth - 1);
          if (parentIndex >= 0) move(parentIndex);
        }
        break;
      case "Enter":
        if (current) activate(current);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(rows.length - 1);
        break;
      default:
        return;
    }
    event.preventDefault();
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
        const top = e.currentTarget.scrollTop;
        setViewport((v) => ({ ...v, top }));
      }}
      className="relative min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-accent/60 focus-visible:ring-inset"
    >
      <div style={{ height: rows.length * ROW_HEIGHT }} className="relative">
        {rows.slice(start, end).map((row, offset) => {
          const index = start + offset;
          const { entry } = row;
          const isSelected = index === selectedIndex;
          const isOpenFile = activeKey === normalizePath(entry.path);
          const spec = entry.isDir ? folderIcon(entry.name, row.expanded) : fileIcon(entry.path);
          const Icon = spec.icon;
          const isLoading = entry.isDir && loading[normalizePath(entry.path)];
          return (
            <RowMenu key={entry.path} row={row} workspace={workspace}>
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
                  paddingLeft: 8 + row.depth * INDENT,
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
                {row.depth > 0 &&
                  Array.from({ length: row.depth }, (_, level) => (
                    <span
                      key={level}
                      className="absolute top-0 bottom-0 w-px bg-border"
                      style={{ left: 14 + level * INDENT }}
                    />
                  ))}
                <span className="flex w-3 shrink-0 justify-center">
                  {entry.isDir && (
                    <ChevronRight
                      className={cn(
                        "size-3 text-faint transition-transform duration-100",
                        row.expanded && "rotate-90",
                        isLoading && "animate-pulse",
                      )}
                    />
                  )}
                </span>
                <Icon className={cn("size-3.5 shrink-0", spec.color)} />
                <span className="min-w-0 truncate">{entry.name}</span>
                {entry.isSymlink && <span className="text-[10px] text-faint">↗</span>}
              </div>
            </RowMenu>
          );
        })}
      </div>
    </div>
  );
};
