import type { DirEntry } from "@/types";

type NavRow = {
  depth: number;
  expanded: boolean;
  entry: Pick<DirEntry, "isDir">;
};

export type TreeKeyAction =
  | { kind: "select"; index: number }
  | { kind: "expand" }
  | { kind: "collapse" }
  | { kind: "activate" }
  | { kind: "none" };

export const treeKeyAction = (
  rows: NavRow[],
  selected: number,
  key: string,
): TreeKeyAction | null => {
  const current = rows[selected];
  const select = (index: number): TreeKeyAction =>
    rows.length
      ? { kind: "select", index: Math.max(0, Math.min(rows.length - 1, index)) }
      : { kind: "none" };
  switch (key) {
    case "ArrowDown":
      return select(selected + 1);
    case "ArrowUp":
      return select(selected < 0 ? 0 : selected - 1);
    case "ArrowRight":
      return current?.entry.isDir && !current.expanded ? { kind: "expand" } : select(selected + 1);
    case "ArrowLeft": {
      if (current?.entry.isDir && current.expanded) return { kind: "collapse" };
      if (!current) return { kind: "none" };
      const parent = rows.slice(0, selected).findLastIndex((r) => r.depth === current.depth - 1);
      return parent >= 0 ? select(parent) : { kind: "none" };
    }
    case "Enter":
      return current ? { kind: "activate" } : { kind: "none" };
    case "Home":
      return select(0);
    case "End":
      return select(rows.length - 1);
    default:
      return null;
  }
};
