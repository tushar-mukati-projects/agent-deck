import { describe, expect, it } from "vitest";

import { sessionInfo } from "@/lib/session-fixture";
import { emptyMessage, groupTone } from "@/lib/sessions-panel";
import type { DotTone } from "@/components/ui/feedback";

describe("groupTone", () => {
  const sessions = [sessionInfo("a"), sessionInfo("b"), sessionInfo("c")];

  it.each<[[string, DotTone][], DotTone | null]>([
    [[], null],
    [[["a", "exited"]], null],
    [
      [
        ["a", "external"],
        ["b", "running"],
      ],
      "running",
    ],
    [
      [
        ["a", "running"],
        ["b", "busy"],
      ],
      "busy",
    ],
    [
      [
        ["a", "busy"],
        ["c", "attention"],
      ],
      "attention",
    ],
  ])("picks the most urgent tone from %j", (tones, tone) => {
    expect(groupTone(sessions, new Map(tones))).toBe(tone);
  });
});

describe("emptyMessage", () => {
  it.each([
    ["fix", null, "No matching sessions", "Try a different search."],
    [
      "fix",
      "C:\\repo",
      "No matching sessions",
      "Try a different search, or clear the folder filter.",
    ],
    [
      "",
      "C:\\repo",
      "No sessions in this folder yet",
      "Start a session in repo and it will show up here.",
    ],
    ["", null, "No sessions yet", "Start a session with any agent and it will show up here."],
  ])("describes query %j in folder %j", (query, folder, title, description) => {
    expect(emptyMessage(query, folder)).toEqual({ title, description });
  });
});
