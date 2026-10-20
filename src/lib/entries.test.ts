import { describe, expect, it } from "vitest";

import { encodeDiffTab } from "@/lib/diff-tabs";
import { entryNameError, movedPath, movedTab } from "@/lib/entries";

describe("entryNameError", () => {
  it.each([
    ["", "Enter a name."],
    [".", "That name isn't allowed."],
    ["..", "That name isn't allowed."],
    ["src/app.ts", "A name can't contain / or \\."],
    ["src\\app.ts", "A name can't contain / or \\."],
    ["notes:v2.md", 'A name can\'t contain < > : " | ? or *.'],
    ["what?.md", 'A name can\'t contain < > : " | ? or *.'],
    ["foo.", "A name can't end with a dot or a space."],
    ["foo ", "A name can't end with a dot or a space."],
    ["CON", "CON is a name Windows reserves."],
    ["nul.txt", "nul.txt is a name Windows reserves."],
    ["console.log", null],
    ["notes.md", null],
    [".env", null],
    ["İndex.ts", null],
  ])("checks %j", (name, error) => {
    expect(entryNameError(name)).toBe(error);
  });
});

describe("movedPath", () => {
  it.each([
    ["C:\\repo\\old", "C:\\repo\\new"],
    ["C:\\repo\\old\\src\\a.ts", "C:\\repo\\new\\src\\a.ts"],
    ["c:\\REPO\\old\\a.ts", "C:\\repo\\new\\a.ts"],
    ["C:\\repo\\older.ts", "C:\\repo\\older.ts"],
    ["C:\\other\\old\\a.ts", "C:\\other\\old\\a.ts"],
  ])("moves %j", (path, moved) => {
    expect(movedPath(path, "C:\\repo\\old", "C:\\repo\\new")).toBe(moved);
  });

  it("moves a WSL path written with wsl$ under the renamed wsl.localhost folder", () => {
    expect(
      movedPath(
        "\\\\wsl$\\Debian\\home\\me\\src\\a.ts",
        "\\\\wsl.localhost\\Debian\\home\\me\\src",
        "\\\\wsl.localhost\\Debian\\home\\me\\lib",
      ),
    ).toBe("\\\\wsl.localhost\\Debian\\home\\me\\lib\\a.ts");
  });
});

describe("movedTab", () => {
  it("moves the path inside a diff tab and keeps the rest", () => {
    const tab = encodeDiffTab({ source: "git", backup: null, path: "C:\\repo\\old\\a.ts" });
    expect(movedTab(tab, "C:\\repo\\old", "C:\\repo\\new")).toBe(
      encodeDiffTab({ source: "git", backup: null, path: "C:\\repo\\new\\a.ts" }),
    );
  });
});
