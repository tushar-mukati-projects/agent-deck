import { describe, expect, it } from "vitest";

import {
  effectiveAgent,
  emptyMessage,
  groupByFolder,
  groupTone,
  partitionSessions,
  splitSingleFolders,
  type SessionFilter,
} from "@/lib/session-list";
import { sessionInfo } from "@/lib/session-fixture";
import type { DotTone } from "@/components/ui/feedback";
import type { SessionInfo } from "@/types";

const session = (id: string, cwd: string, extra: Partial<SessionInfo> = {}) =>
  sessionInfo(id, { cwd, ...extra });

const filter = (extra: Partial<SessionFilter> = {}): SessionFilter => ({
  agent: "all",
  folder: null,
  includeSubfolders: true,
  query: "",
  pinnedIds: [],
  archivedIds: [],
  ...extra,
});

const sessions = [
  session("a", "C:\\repo", { title: "Fix login bug" }),
  session("b", "C:\\repo\\web", { agent: "codex", gitBranch: "feature/ui" }),
  session("c", "C:\\other"),
];

describe("partitionSessions", () => {
  it("filters by folder, subfolders, agent and every search word", () => {
    const ids = (f: Partial<SessionFilter>) =>
      partitionSessions(sessions, filter(f)).rest.map((s) => s.id);
    expect(ids({ folder: "c:\\REPO" })).toEqual(["a", "b"]);
    expect(ids({ folder: "C:\\repo", includeSubfolders: false })).toEqual(["a"]);
    expect(ids({ agent: "codex" })).toEqual(["b"]);
    expect(ids({ query: "login fix" })).toEqual(["a"]);
    expect(ids({ query: "FEATURE" })).toEqual(["b"]);
  });

  it("keeps pinned order, hides archived from the other lists", () => {
    const result = partitionSessions(
      sessions,
      filter({ pinnedIds: ["c", "a"], archivedIds: ["b", "a"] }),
    );
    expect(result.pinned.map((s) => s.id)).toEqual(["c"]);
    expect(result.archived.map((s) => s.id)).toEqual(["a", "b"]);
    expect(result.rest).toEqual([]);
    expect(result.total).toBe(3);
  });

  it("ignores a saved agent filter when that agent has no sessions", () => {
    expect(effectiveAgent("custom:gone", sessions)).toBe("all");
    expect(effectiveAgent("codex", sessions)).toBe("codex");
    expect(partitionSessions(sessions, filter({ agent: "custom:gone" })).rest).toHaveLength(3);
  });
});

describe("groupByFolder", () => {
  it("groups folders case-insensitively in first-seen order", () => {
    const groups = groupByFolder([
      session("a", "C:\\Repo"),
      session("b", "C:\\x"),
      session("c", "c:\\repo"),
    ]);
    expect(groups.map((g) => [g.cwd, g.sessions.map((s) => s.id)])).toEqual([
      ["C:\\Repo", ["a", "c"]],
      ["C:\\x", ["b"]],
    ]);
  });

  it("gathers one-session folders when another folder has several", () => {
    const { folders, singles } = splitSingleFolders(
      groupByFolder([
        session("a", "C:\\repo"),
        session("b", "C:\\x"),
        session("c", "C:\\repo"),
        session("d", "C:\\y"),
      ]),
    );
    expect(folders.map((g) => g.cwd)).toEqual(["C:\\repo"]);
    expect(singles.map((s) => s.id)).toEqual(["b", "d"]);
  });

  it("keeps every folder as its own section when none has several sessions", () => {
    const { folders, singles } = splitSingleFolders(
      groupByFolder([session("b", "C:\\x"), session("d", "C:\\y")]),
    );
    expect(folders.map((g) => g.cwd)).toEqual(["C:\\x", "C:\\y"]);
    expect(singles).toEqual([]);
  });
});

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
