import { describe, expect, it } from "vitest";

import { callResultParts, gridFromObjects, resourceTexts, toCsv } from "@/lib/mcp/results";

describe("gridFromObjects", () => {
  it.each([
    [[], null],
    [[1, 2], null],
    [[{ a: 1 }, [2]], null],
    ["text", null],
    [
      [{ a: 1, b: null }, { b: { c: true } }],
      { columns: ["a", "b"], rows: [["1", null], [null, '{"c":true}']] },
    ],
  ])("turns %j into %j", (value, grid) => expect(gridFromObjects(value)).toEqual(grid));
});

describe("toCsv", () => {
  it("quotes cells with commas, quotes and line breaks", () =>
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line\nbreak", null]])).toBe(
      'a,b\n"x,y","say ""hi"""\n"line\nbreak",',
    ));
});

describe("callResultParts", () => {
  it.each([
    [null, { content: [], isError: false, structured: undefined }],
    [
      { content: [{ type: "text", text: "hi" }, 3], isError: true, structuredContent: { n: 1 } },
      { content: [{ type: "text", text: "hi" }], isError: true, structured: { n: 1 } },
    ],
  ])("reads %j", (result, parts) => expect(callResultParts(result)).toEqual(parts));
});

describe("resourceTexts", () => {
  it("keeps text and prints other contents as JSON", () =>
    expect(resourceTexts({ contents: [{ text: "a" }, { uri: "x" }] })).toEqual([
      "a",
      '{\n  "uri": "x"\n}',
    ]));
});
