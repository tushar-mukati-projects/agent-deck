import { describe, expect, it } from "vitest";

import { parseArgs } from "@/lib/args";
import { isWithin, normalizePath, relativePath, resolvePath, samePath } from "@/lib/utils";
import { parseWslPath, shellQuote } from "@/lib/wsl";

describe("normalizePath", () => {
  it("lowercases Windows paths", () => {
    expect(normalizePath("C:\\Users\\Me\\Repo\\")).toBe("c:\\users\\me\\repo");
  });

  it("keeps WSL paths case-sensitive and unifies the wsl$ prefix", () => {
    expect(normalizePath("\\\\wsl$\\Debian\\home\\me\\README.md")).toBe(
      "\\\\wsl.localhost\\Debian\\home\\me\\README.md",
    );
    expect(
      samePath(
        "\\\\wsl.localhost\\Debian\\a\\README.md",
        "\\\\wsl.localhost\\Debian\\a\\readme.md",
      ),
    ).toBe(false);
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
});
