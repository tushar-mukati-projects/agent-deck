import { describe, expect, it } from "vitest";

import { entryNameError, movedPath } from "@/lib/entries";

describe("entryNameError", () => {
  it.each([
    ["", "Enter a name."],
    ["src/app.ts", "A name can't contain / or \\."],
    ["src\\app.ts", "A name can't contain / or \\."],
    [".", "That name isn't allowed."],
    ["..", "That name isn't allowed."],
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
});
