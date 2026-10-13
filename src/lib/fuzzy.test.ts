import { describe, expect, it } from "vitest";

import { fuzzyPathKeyScorer, pathKey } from "@/lib/fuzzy";

const cases: [string, string, number | null][] = [
  ["app", "src\\App.tsx", 1596.5],
  ["sp", "src/features/sidebar/SessionsPanel.tsx", 1384.5],
  ["side panel", "src\\features\\sidebar\\SessionsPanel.tsx", 670.4],
  ["zzz", "src/App.tsx", null],
  ["", "README.md", 400],
  ["i", "İndex.ts", 1596],
];

describe("fuzzyPathKeyScorer", () => {
  it("scores paths by name and full path", () => {
    for (const [query, path, score] of cases)
      expect(fuzzyPathKeyScorer(query)(pathKey(path))).toBe(score);
  });

  it("never matches a longer query where its prefix fails", () => {
    const paths = [
      "src/App.tsx",
      "src\\features\\sidebar\\SessionsPanel.tsx",
      "src/lib/terminal/registry.ts",
      "docs/tab scroll notes.md",
      "README.md",
    ].map(pathKey);
    const queries = ["tabs scroll wheel", "side panel", "registry", "src app", "a b c"];
    for (const query of queries) {
      for (let end = 1; end < query.length; end++) {
        const prefix = query.slice(0, end).trim();
        const longer = query.slice(0, end + 1).trim();
        for (const key of paths) {
          if (fuzzyPathKeyScorer(longer)(key) !== null)
            expect(fuzzyPathKeyScorer(prefix)(key)).not.toBeNull();
        }
      }
    }
  });
});
