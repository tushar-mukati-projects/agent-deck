import { describe, expect, it } from "vitest";

import { ADOPT_AFTER_MS, adoptSessions } from "@/lib/adopt";
import { blankWorkspace } from "@/stores/workspace-factory";
import type { SessionInfo, Workspace } from "@/types";

const T = Date.parse("2026-09-29T10:00:00Z");

const pendingTab = (id: string, since: number, cwd = "C:\\repo"): Workspace => ({
  ...blankWorkspace({
    id,
    sessionId: `deck-${id}`,
    cwd,
    title: "New Codex session",
    filePath: null,
  }),
  agent: "codex",
  mode: "live",
  pendingSince: since,
});

const codexSession = (id: string, started: number, cwd = "C:\\repo"): SessionInfo => ({
  id,
  agent: "codex",
  distro: null,
  filePath: `C:\\codex\\${id}.jsonl`,
  projectKey: "",
  cwd,
  title: `title ${id}`,
  customTitle: null,
  firstPrompt: null,
  lastPrompt: null,
  gitBranch: null,
  startedAt: new Date(started).toISOString(),
  modifiedMs: started,
  promptCount: 1,
  size: 1,
  version: null,
  recentCwds: [],
});

const byId = (...sessions: SessionInfo[]) => Object.fromEntries(sessions.map((s) => [s.id, s]));

describe("adoptSessions", () => {
  it("links a pending tab to the session its agent created", () => {
    const [tab] = adoptSessions([pendingTab("a", T)], byId(codexSession("s1", T + 2000)));
    expect(tab).toMatchObject({
      sessionId: "s1",
      filePath: "C:\\codex\\s1.jsonl",
      pendingSince: null,
    });
    expect(tab.title).toBe("title s1");
  });

  it("returns the same list when nothing matches", () => {
    const tabs = [pendingTab("a", T)];
    expect(adoptSessions(tabs, byId(codexSession("old", T - 60_000)))).toBe(tabs);
    expect(adoptSessions(tabs, byId(codexSession("late", T + ADOPT_AFTER_MS + 1)))).toBe(tabs);
    expect(adoptSessions(tabs, byId(codexSession("elsewhere", T + 1000, "C:\\other")))).toBe(tabs);
    expect(
      adoptSessions(tabs, byId({ ...codexSession("claude", T + 1000), agent: "claude" })),
    ).toBe(tabs);
    expect(
      adoptSessions(tabs, byId({ ...codexSession("nostart", T + 1000), startedAt: null })),
    ).toBe(tabs);
  });

  it("pairs each tab with the session closest to when it started", () => {
    const tabs = [pendingTab("a", T), pendingTab("b", T + 5000)];
    const result = adoptSessions(
      tabs,
      byId(codexSession("s2", T + 6000), codexSession("s1", T + 7000)),
    );
    expect(result.map((w) => w.sessionId)).toEqual(["s1", "s2"]);
  });

  it("ignores stale tabs from long ago", () => {
    const tabs = [pendingTab("stale", T - 3_600_000), pendingTab("fresh", T)];
    const result = adoptSessions(tabs, byId(codexSession("s1", T + 1000)));
    expect(result.map((w) => w.sessionId)).toEqual(["deck-stale", "s1"]);
  });

  it("never adopts a session that is already open in a tab", () => {
    const open = { ...pendingTab("open", T), sessionId: "s1", pendingSince: null };
    const tabs = [open, pendingTab("a", T)];
    expect(adoptSessions(tabs, byId(codexSession("s1", T + 1000)))).toBe(tabs);
  });
});
