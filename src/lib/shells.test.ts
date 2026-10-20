import { describe, expect, it } from "vitest";

import { shellName, shellPath } from "@/lib/shells";

describe("shellName", () => {
  it.each([
    ["C:\\Program Files\\PowerShell\\7\\pwsh.exe", 0, "pwsh 1"],
    ["C:\\Windows\\System32\\CMD.EXE", 1, "CMD 2"],
    ["wsl", 2, "wsl 3"],
  ])("names %s at index %i as %s", (program, index, name) =>
    expect(shellName({ program }, index)).toBe(name),
  );
});

describe("shellPath", () => {
  it.each([
    ["C:\\repo\\a b.ts", '"C:\\repo\\a b.ts" '],
    ["\\\\wsl.localhost\\Debian\\home\\me\\a.ts", "/home/me/a.ts "],
    ["\\\\wsl.localhost\\Debian\\home\\me\\a b.ts", "'/home/me/a b.ts' "],
  ])("quotes %s as %s", (path, text) => expect(shellPath(path)).toBe(text));
});
