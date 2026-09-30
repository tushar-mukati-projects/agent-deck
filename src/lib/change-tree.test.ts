import { describe, expect, it } from "vitest";

import { buildChangeTree, type ChangeNode } from "@/lib/change-tree";

const root = "C:\\repo";

const outline = (nodes: ChangeNode<string>[], depth = 0): string[] =>
  nodes.flatMap((node) =>
    node.kind === "folder"
      ? [`${"  ".repeat(depth)}${node.name}/`, ...outline(node.children, depth + 1)]
      : [`${"  ".repeat(depth)}${node.item.slice(node.item.lastIndexOf("\\") + 1)}`],
  );

const tree = (paths: string[]) => outline(buildChangeTree(paths, (p) => p, root));

describe("grouping changed files into folders", () => {
  it("puts folders before files and sorts names naturally", () => {
    expect(
      tree([
        "C:\\repo\\README.md",
        "C:\\repo\\src\\b.ts",
        "C:\\repo\\src\\a10.ts",
        "C:\\repo\\src\\a2.ts",
        "C:\\repo\\docs\\guide.md",
        "C:\\repo\\src\\ui\\x.tsx",
      ]),
    ).toEqual([
      "docs/",
      "  guide.md",
      "src/",
      "  ui/",
      "    x.tsx",
      "  a2.ts",
      "  a10.ts",
      "  b.ts",
      "README.md",
    ]);
  });

  it("joins folders that only hold one folder", () => {
    expect(tree(["C:\\repo\\src\\lib\\agents\\a.ts", "C:\\repo\\src\\lib\\agents\\b.ts"])).toEqual([
      "src/lib/agents/",
      "  a.ts",
      "  b.ts",
    ]);
  });

  it("groups files outside the project under their own folder", () => {
    const nodes = buildChangeTree(
      ["C:\\Users\\me\\.claude\\plans\\p.md", "C:\\repo\\a.ts"],
      (p) => p,
      root,
    );
    expect(outline(nodes)).toEqual(["C:\\Users\\me\\.claude\\plans/", "  p.md", "a.ts"]);
    expect(nodes[0].kind === "folder" && nodes[0].path).toBe("C:\\Users\\me\\.claude\\plans");
  });

  it("gives every folder its real path", () => {
    const [src] = buildChangeTree(
      ["C:\\repo\\src\\ui\\x.tsx", "C:\\repo\\src\\y.ts"],
      (p) => p,
      root,
    );
    expect(src.kind === "folder" && src.path).toBe("C:\\repo\\src");
  });
});
