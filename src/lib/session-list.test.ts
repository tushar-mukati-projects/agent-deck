import { describe, expect, it } from "vitest";

import {
  effectiveAgent,
  folderHints,
  groupByFolder,
  partitionSessions,
  type SessionFilter,
} from "@/lib/session-list";
import type { SessionInfo } from "@/types";

const session = (id: string, cwd: string, extra: Partial<SessionInfo> = {}) =>
  ({
    id,
    cwd,
    agent: "claude",
    title: id,
    firstPrompt: null,
    lastPrompt: null,
    gitBranch: null,
    ...extra,
  }) as SessionInfo;

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

  it("hints the parent folder only for folders that share a name", () => {
    const groups = groupByFolder([
      session("a", "C:\\dev\\api"),
      session("b", "C:\\old\\API"),
      session("c", "C:\\dev\\web"),
    ]);
    expect([...folderHints(groups)]).toEqual([
      ["C:\\dev\\api", "dev"],
      ["C:\\old\\API", "old"],
    ]);
  });

  it("shows the whole parent path when parent names collide too", () => {
    const groups = groupByFolder([session("a", "C:\\a\\work\\app"), session("b", "D:\\work\\app")]);
    expect([...folderHints(groups)]).toEqual([
      ["C:\\a\\work\\app", "C:\\a\\work"],
      ["D:\\work\\app", "D:\\work"],
    ]);
  });
});
