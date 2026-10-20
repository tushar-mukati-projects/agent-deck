import { Fragment } from "react";

import { Chevron } from "@/components/ui/chevron";
import { TreeGuides, treeIndent } from "@/features/explorer/TreeGuides";
import type { ChangeFolder, ChangeNode } from "@/lib/change-tree";
import { FileIcon, folderIcon } from "@/lib/file-icons";
import { DECK_PATH_MIME } from "@/lib/terminal/input";
import { basename, cn, shortenHome } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import type { ChangeStatus } from "@/types";

interface Badge {
  letter: string;
  className: string;
  label: string;
}

export const STATUS_BADGE: Record<ChangeStatus, Badge> = {
  added: { letter: "A", className: "text-add", label: "Added" },
  modified: { letter: "M", className: "text-mod", label: "Modified" },
  deleted: { letter: "D", className: "text-del", label: "Deleted" },
  unchanged: { letter: "·", className: "text-faint", label: "Changed, then restored" },
};

const rowClass =
  "relative flex h-[26px] w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left text-[12px] hover:bg-hover";

type ChangeRowProps = {
  path: string;
  depth: number;
  badge: Badge;
  onOpen: () => void;
  children?: React.ReactNode;
};

export const ChangeRow = ({ path, depth, badge, onOpen, children }: ChangeRowProps) => (
  <button
    type="button"
    onClick={onOpen}
    title={path}
    draggable
    onDragStart={(e) => e.dataTransfer.setData(DECK_PATH_MIME, path)}
    style={{ paddingLeft: treeIndent(depth) }}
    className={rowClass}
  >
    <TreeGuides depth={depth} />
    <span className="w-3 shrink-0" />
    <FileIcon path={path} />
    <span className="min-w-0 flex-1 truncate text-fg/90">{basename(path)}</span>
    {children}
    <span
      title={badge.label}
      className={cn(
        "w-3 shrink-0 text-center font-mono text-[11px] font-semibold",
        badge.className,
      )}
    >
      {badge.letter}
    </span>
  </button>
);

type FolderRowProps = {
  folder: ChangeFolder<unknown>;
  depth: number;
  open: boolean;
  onToggle: () => void;
};

const FolderRow = ({ folder, depth, open, onToggle }: FolderRowProps) => {
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const { icon: Icon, color } = folderIcon(basename(folder.path), open);
  return (
    <button
      type="button"
      onClick={onToggle}
      title={folder.path}
      aria-expanded={open}
      style={{ paddingLeft: treeIndent(depth) }}
      className={cn(rowClass, "text-fg/85")}
    >
      <TreeGuides depth={depth} />
      <Chevron open={open} className="text-faint" />
      <Icon className={cn("size-3.5 shrink-0", color)} />
      <span className="min-w-0 truncate">{shortenHome(folder.name, home)}</span>
    </button>
  );
};

interface ChangeTreeProps<T> {
  nodes: ChangeNode<T>[];
  depth?: number;
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
  renderFile: (item: T, depth: number) => React.ReactNode;
}

export const ChangeTree = <T,>({
  nodes,
  depth = 0,
  collapsed,
  onToggle,
  renderFile,
}: ChangeTreeProps<T>) =>
  nodes.map((node) => {
    if (node.kind === "file")
      return <Fragment key={node.key}>{renderFile(node.item, depth)}</Fragment>;
    const open = !collapsed.has(node.key);
    return (
      <Fragment key={node.key}>
        <FolderRow folder={node} depth={depth} open={open} onToggle={() => onToggle(node.key)} />
        {open && (
          <ChangeTree
            nodes={node.children}
            depth={depth + 1}
            collapsed={collapsed}
            onToggle={onToggle}
            renderFile={renderFile}
          />
        )}
      </Fragment>
    );
  });
