import { describe, expect, it } from "vitest";

import { parseArgs } from "@/lib/args";
import { isWithin, normalizePath, relativePath, resolvePath, samePath } from "@/lib/utils";
import { parseWslPath, shellQuote } from "@/lib/wsl";

describe("normalizePath", () => {
  it("lowercases Windows paths", () => {
    expect(normalizePath("C:\\Users\\Me\\Repo\\")).toBe("c:\\users\\me\\repo");
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

describe("wsl", () => {
  it("parses host paths", () => {
    expect(parseWslPath("\\\\wsl.localhost\\Debian\\home\\me")).toEqual({
      distro: "Debian",
      linuxPath: "/home/me",
    });
    expect(parseWslPath("C:\\Users")).toBeNull();
  });

  it("quotes shell arguments safely", () => {
    expect(shellQuote("--resume")).toBe("--resume");
    expect(shellQuote("it's")).toBe(`'it'"'"'s'`);
  });
});

describe("parseArgs", () => {
  it("keeps quoted values together", () => {
    expect(parseArgs('--model opus --x="a b" "c d"')).toEqual([
      "--model",
      "opus",
      "--x=a b",
      "c d",
    ]);
  });

  it("understands single quotes and keeps quotes inside them", () => {
    expect(parseArgs("--append-system-prompt 'be terse'")).toEqual([
      "--append-system-prompt",
      "be terse",
    ]);
    expect(parseArgs(`--settings '{"theme":"dark"}'`)).toEqual(["--settings", '{"theme":"dark"}']);
    expect(parseArgs(`-c 'model="o3"'`)).toEqual(["-c", 'model="o3"']);
  });

  it("handles escaped quotes, empty values and Windows paths", () => {
    expect(parseArgs(String.raw`--settings {\"theme\":\"dark\"}`)).toEqual([
      "--settings",
      '{"theme":"dark"}',
    ]);
    expect(parseArgs(String.raw`"say \"hi\"" ''`)).toEqual(['say "hi"', ""]);
    expect(parseArgs(String.raw`--add-dir C:\Users\me\repo`)).toEqual([
      "--add-dir",
      String.raw`C:\Users\me\repo`,
    ]);
    expect(parseArgs("   ")).toEqual([]);
  });
});
