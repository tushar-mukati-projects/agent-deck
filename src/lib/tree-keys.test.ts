import { describe, expect, it } from "vitest";

import { treeKeyAction } from "@/lib/tree-keys";

const row = (depth: number, isDir: boolean, expanded = false) => ({
  depth,
  expanded,
  entry: { isDir },
});

const rows = [row(0, true, true), row(1, false), row(1, true), row(0, false)];

describe("treeKeyAction", () => {
  it.each([
    ["ArrowDown", 1, { kind: "select", index: 2 }],
    ["ArrowDown", 3, { kind: "select", index: 3 }],
    ["ArrowUp", -1, { kind: "select", index: 0 }],
    ["ArrowUp", 2, { kind: "select", index: 1 }],
    ["ArrowRight", 2, { kind: "expand" }],
    ["ArrowRight", 1, { kind: "select", index: 2 }],
    ["ArrowLeft", 0, { kind: "collapse" }],
    ["ArrowLeft", 2, { kind: "select", index: 0 }],
    ["ArrowLeft", 3, { kind: "none" }],
    ["ArrowLeft", -1, { kind: "none" }],
    ["Enter", 1, { kind: "activate" }],
    ["Enter", -1, { kind: "none" }],
    ["Home", 2, { kind: "select", index: 0 }],
    ["End", 0, { kind: "select", index: 3 }],
    ["a", 0, null],
  ])("maps %s at row %i", (key, selected, action) =>
    expect(treeKeyAction(rows, selected, key)).toEqual(action),
  );

  it("does nothing on an empty tree", () =>
    expect(treeKeyAction([], -1, "ArrowDown")).toEqual({ kind: "none" }));
});
