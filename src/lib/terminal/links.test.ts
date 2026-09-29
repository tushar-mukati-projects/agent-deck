import { describe, expect, it } from "vitest";

import { candidatePaths } from "@/lib/terminal/links";

describe("candidatePaths", () => {
  it("tries each recent working folder, newest first, without duplicates", () => {
    expect(
      candidatePaths("src\\features\\mcp\\PgBrowser.tsx", [
        "C:\\Users\\me\\my-files\\dev\\claude-deck\\src-tauri",
        "C:\\Users\\me\\my-files\\dev\\claude-deck",
        "c:\\users\\me\\my-files\\dev\\claude-deck",
        "C:\\Users\\me\\my-files",
      ]),
    ).toEqual([
      "C:\\Users\\me\\my-files\\dev\\claude-deck\\src-tauri\\src\\features\\mcp\\PgBrowser.tsx",
      "C:\\Users\\me\\my-files\\dev\\claude-deck\\src\\features\\mcp\\PgBrowser.tsx",
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
});
