import { describe, expect, it } from "vitest";

import { candidatePaths } from "@/lib/terminal/links";

describe("candidatePaths", () => {
  it("tries each recent working folder, newest first, without duplicates", () => {
    expect(
      candidatePaths("src\\features\\mcp\\PgBrowser.tsx", [
        "C:\\Users\\me\\my-files\\dev\\agent-deck\\src-tauri",
        "C:\\Users\\me\\my-files\\dev\\agent-deck",
        "c:\\users\\me\\my-files\\dev\\agent-deck",
        "C:\\Users\\me\\my-files",
      ]),
    ).toEqual([
      "C:\\Users\\me\\my-files\\dev\\agent-deck\\src-tauri\\src\\features\\mcp\\PgBrowser.tsx",
      "C:\\Users\\me\\my-files\\dev\\agent-deck\\src\\features\\mcp\\PgBrowser.tsx",
      "C:\\Users\\me\\my-files\\src\\features\\mcp\\PgBrowser.tsx",
    ]);
  });

  it("keeps absolute paths and maps Linux paths into the WSL distro", () => {
    expect(candidatePaths("C:\\x\\a.ts", ["D:\\repo"])).toEqual(["C:\\x\\a.ts"]);
    expect(candidatePaths("/home/me/a.py", ["\\\\wsl.localhost\\Debian\\home\\me\\w"])).toEqual([
      "\\\\wsl.localhost\\Debian\\home\\me\\a.py",
    ]);
    expect(candidatePaths("./b.md", ["C:\\repo"])).toEqual(["C:\\repo\\b.md"]);
  });

  it.each([
    ["../src/x.ts", "C:\\repo\\app", "C:\\repo\\src\\x.ts"],
    ["..\\..\\x.ts", "C:\\repo\\app\\web", "C:\\repo\\x.ts"],
    ["./lib/../y.ts", "C:\\repo", "C:\\repo\\y.ts"],
    [
      "../a.py",
      "\\\\wsl.localhost\\Debian\\home\\me\\w",
      "\\\\wsl.localhost\\Debian\\home\\me\\a.py",
    ],
  ])("resolves %s against %s", (raw, base, path) =>
    expect(candidatePaths(raw, [base])).toEqual([path]),
  );
});
