import { describe, expect, it } from "vitest";

import {
  formatBytes,
  groupBy,
  isWithin,
  normalizePath,
  relativePath,
  resolvePath,
  samePath,
  shortTimeAgo,
} from "@/lib/utils";

describe("normalizePath", () => {
  it("lowercases Windows paths", () => {
    expect(normalizePath("C:\\Users\\me\\Repo\\")).toBe("c:\\users\\me\\repo");
  });

  it("keeps Linux paths case-sensitive and unifies the WSL prefix and distro", () => {
    expect(normalizePath("\\\\wsl$\\Debian\\home\\me\\README.md")).toBe(
      "\\\\wsl.localhost\\debian\\home\\me\\README.md",
    );
    expect(
      samePath(
        "\\\\wsl.localhost\\Debian\\a\\README.md",
        "\\\\wsl.localhost\\Debian\\a\\readme.md",
      ),
    ).toBe(false);
    expect(samePath("\\\\WSL.LOCALHOST\\debian\\a", "\\\\wsl$\\Debian\\a\\")).toBe(true);
  });
});

describe("path helpers", () => {
  it("detects nesting", () => {
    expect(isWithin("C:\\a\\b\\c.ts", "C:\\a")).toBe(true);
    expect(isWithin("C:\\ab\\c.ts", "C:\\a")).toBe(false);
  });

  it("resolves relative segments", () => {
    expect(resolvePath("C:\\a\\b", "../c/d.md")).toBe("C:\\a\\c\\d.md");
  });

  it("makes paths relative to a root", () => {
    expect(relativePath("C:\\a\\b\\c.ts", "C:\\a")).toBe("b\\c.ts");
    expect(relativePath("C:\\a", "C:\\a")).toBe("C:\\a");
    expect(relativePath("C:/A/b/c.ts", "c:\\a\\")).toBe("b\\c.ts");
    expect(relativePath("D:\\x.ts", "D:\\")).toBe("x.ts");
    expect(
      relativePath(
        "\\\\wsl.localhost\\Ubuntu\\home\\me\\proj\\src\\a.ts",
        "\\\\wsl$\\Ubuntu\\home\\me\\proj",
      ),
    ).toBe("src\\a.ts");
  });
});

describe("formatBytes", () => {
  it.each([
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [10137, "9.9 KB"],
    [10199, "10 KB"],
    [1047961, "1023 KB"],
    [1048575, "1.0 MB"],
    [10 * 1024 * 1024, "10 MB"],
  ])("formats %j as %j", (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});

describe("shortTimeAgo", () => {
  it("uses one compact unit", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    const ago = (ms: number) => shortTimeAgo(now - ms, now);
    expect(ago(20_000)).toBe("now");
    expect(ago(5 * 60_000)).toBe("5m");
    expect(ago(3 * 3_600_000)).toBe("3h");
    expect(ago(2 * 86_400_000)).toBe("2d");
    expect(ago(21 * 86_400_000)).toBe("3w");
    expect(ago(65 * 86_400_000)).toBe("2mo");
    expect(ago(800 * 86_400_000)).toBe("2y");
    expect(shortTimeAgo(now + 5_000, now)).toBe("now");
  });
});

describe("groupBy", () => {
  it("keeps the first-seen order of keys and of items within a key", () => {
    const groups = groupBy(["b1", "a1", "b2", "c1", "a2"], (id) => id[0]);
    expect([...groups.entries()]).toEqual([
      ["b", ["b1", "b2"]],
      ["a", ["a1", "a2"]],
      ["c", ["c1"]],
    ]);
  });

  it("returns an empty map for no items", () => {
    expect(groupBy([], (id: string) => id).size).toBe(0);
  });
});
