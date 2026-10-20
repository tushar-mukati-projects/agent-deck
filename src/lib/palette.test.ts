import { describe, expect, it } from "vitest";

import { pathKey } from "@/lib/fuzzy";
import { sortTop, topFiles } from "@/lib/palette";

const prepare = (rels: string[]) => rels.map((rel) => ({ rel, key: pathKey(rel) }));

describe("topFiles", () => {
  const files = prepare(["src/app.ts", "src/main.ts", "README.md", "src/lib/palette.ts"]);

  it("keeps the listing order and every file without a query", () => {
    const { top, matched } = topFiles(files, "", 2);
    expect(top).toEqual([
      { rel: "src/app.ts", score: 0 },
      { rel: "src/main.ts", score: 0 },
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
