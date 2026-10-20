import { describe, expect, it } from "vitest";

import { pathKey } from "@/lib/fuzzy";
import { emptyHint, foldersOf, sortTop, topFiles, type EmptyHintState } from "@/lib/palette";

const prepare = (rels: string[], isDir = false) =>
  rels.map((rel) => ({ rel, key: pathKey(rel), isDir }));

describe("foldersOf", () => {
  it("lists every folder above the files once, keeping their separators", () => {
    expect(foldersOf(["src\\lib\\a.ts", "src\\b.ts", "docs/guide/c.md", "README.md"])).toEqual([
      "src\\lib",
      "src",
      "docs/guide",
      "docs",
    ]);
  });

  it("lists nothing for top-level files", () => {
    expect(foldersOf(["README.md", "package.json"])).toEqual([]);
  });
});

describe("topFiles", () => {
  const files = prepare(["src/app.ts", "src/main.ts", "README.md", "src/lib/palette.ts"]);

  it("keeps the listing order and every file without a query", () => {
    const { top, matched } = topFiles(files, "", 2);
    expect(top).toEqual([
      { rel: "src/app.ts", isDir: false, score: 0 },
      { rel: "src/main.ts", isDir: false, score: 0 },
    ]);
    expect(matched).toBe(files);
  });

  it("returns the best matches first, capped at the limit, and every match", () => {
    const { top, matched } = topFiles(files, "ts", 2);
    expect(top).toHaveLength(2);
    expect(top[0].score).toBeGreaterThanOrEqual(top[1].score);
    expect(matched.map((file) => file.rel)).toEqual([
      "src/app.ts",
      "src/main.ts",
      "src/lib/palette.ts",
    ]);
  });

  it("ranks folders with the files and keeps which is which", () => {
    const { top } = topFiles([...files, ...prepare(["src/lib"], true)], "lib", 1);
    expect(top).toEqual([{ rel: "src/lib", isDir: true, score: expect.any(Number) }]);
  });

  it("matches nothing for an unknown query", () => {
    expect(topFiles(files, "zzz", 5)).toEqual({ top: [], matched: [] });
  });
});

describe("sortTop", () => {
  it("sorts by score and keeps the first ones", () => {
    const items = [{ score: 1 }, { score: 3 }, { score: 2 }];
    expect(sortTop(items, 2)).toEqual([{ score: 3 }, { score: 2 }]);
  });
});

describe("emptyHint", () => {
  const base: EmptyHintState = {
    mode: "chats",
    hasWorkspace: true,
    query: "deploy",
    searchingChats: false,
    chatError: null,
    filesError: null,
  };

  it.each<[Partial<EmptyHintState>, string]>([
    [{ mode: "files", hasWorkspace: false }, "Open a session to search its files."],
    [{ mode: "files" }, "Nothing matches."],
    [{ mode: "all" }, "Nothing matches."],
    [
      { mode: "files", filesError: "Couldn't list this folder's files: access denied" },
      "Couldn't list this folder's files: access denied",
    ],
    [
      { mode: "all", filesError: "Couldn't list this folder's files: access denied" },
      "Couldn't list this folder's files: access denied",
    ],
    [{ query: "d" }, "Type at least 2 characters to search every conversation."],
    [{ searchingChats: true }, "Searching conversations…"],
    [{}, "No conversation mentions that."],
    [
      { chatError: "Couldn't search conversations: disk unreadable" },
      "Couldn't search conversations: disk unreadable",
    ],
  ])("shows the right hint for %j", (state, hint) => {
    expect(emptyHint({ ...base, ...state })).toBe(hint);
  });
});
