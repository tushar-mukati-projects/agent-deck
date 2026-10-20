import { describe, expect, it } from "vitest";

import { CLAUDE, CODEX } from "@/lib/agents/registry";
import { changeDiffSource, gitChangeStatus, gitMessage } from "@/lib/changes";
import type { ChangedFile } from "@/types";

const file = (backup: string | null): ChangedFile => ({
  path: "C:\\repo\\a.ts",
  status: "modified",
  additions: 1,
  deletions: 0,
  backup,
});

describe("gitChangeStatus", () => {
  it.each([
    ["??", "added"],
    ["A", "added"],
    ["AM", "added"],
    ["D", "deleted"],
    ["MD", "deleted"],
    ["M", "modified"],
    ["R", "modified"],
    ["UU", "modified"],
  ])("maps %s to %s", (code, status) => expect(gitChangeStatus(code)).toBe(status));
});

describe("gitMessage", () => {
  it.each([
    ["fatal: not a git repository (or any of the parent directories): .git", "Not a git repository."],
    ["git is not available", "git is not available"],
  ])("shows %s as %s", (error, message) => expect(gitMessage(error)).toBe(message));
});

describe("changeDiffSource", () => {
  it.each([
    [file("abc@v1"), CODEX, "session"],
    [file(null), CLAUDE, "session"],
    [file(null), CODEX, "git"],
  ] as const)("picks the diff source for %#", (changed, agent, source) =>
    expect(changeDiffSource(changed, agent)).toBe(source),
  );
});
