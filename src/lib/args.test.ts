import { describe, expect, it } from "vitest";

import { parseArgs } from "@/lib/args";

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
