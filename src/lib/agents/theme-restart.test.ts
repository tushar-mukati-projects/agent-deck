import { beforeEach, describe, expect, it } from "vitest";

import {
  launchTheme,
  readyToRestart,
  themeOutdated,
  type RestartContext,
} from "@/lib/agents/theme-restart";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { blankWorkspace } from "@/stores/workspace-factory";
import type { LiveSession, TerminalState, Workspace } from "@/types";

const id = "00000000-0000-4000-8000-000000000002";
const now = 1_000_000;
const dark = ["--settings", '{"theme":"dark-ansi"}'];

const workspace = (extra: Partial<Workspace> = {}): Workspace => ({
  ...blankWorkspace({
    id: "w",
    sessionId: id,
    cwd: "C:\\repo",
    title: "t",
    filePath: "C:\\x.jsonl",
  }),
  mode: "live",
  agentTerminalId: "term",
  agentArgs: ["--resume", id, ...dark],
  ...extra,
});

const terminal = (extra: Partial<TerminalState> = {}): TerminalState => ({
  id: "term",
  kind: "agent",
  workspaceId: "w",
  cwd: "C:\\repo",
  status: "running",
  pid: 42,
  exitCode: null,
  error: null,
  busy: false,
  attention: false,
  ...extra,
});

const live = (status: string, pid = 42): LiveSession => ({
  distro: null,
  sessionId: id,
  pid,
  cwd: "C:\\repo",
  status,
  kind: "interactive",
  name: null,
  startedAt: 1,
});

const context = (extra: Partial<RestartContext> = {}): RestartContext => ({
  terminal: terminal(),
  live: [live("idle")],
  input: { typedAt: now - 60_000, hasDraft: false },
  now,
  ...extra,
});

describe("restarting Claude for a new theme", () => {
  beforeEach(() => {
    useSettingsStore
      .getState()
      .set({ claudeArgs: "", matchAgentTheme: true, themeId: "snow", customAgents: [] });
    useSessionsStore.setState({ byId: {} });
  });

  it("reads the theme Deck launched Claude with", () => {
    expect(launchTheme(dark)).toBe("dark-ansi");
    expect(launchTheme(["--settings", "my.json"])).toBeNull();
    expect(launchTheme(["--resume", id])).toBeNull();
  });

  it("flags live Claude sessions whose theme no longer matches Deck", () => {
    expect(themeOutdated(workspace())).toBe(true);
    useSettingsStore.getState().set({ themeId: "deck" });
    expect(themeOutdated(workspace())).toBe(false);
    expect(themeOutdated(workspace({ mode: "preview" }))).toBe(false);
    expect(themeOutdated(workspace({ agent: "codex" }))).toBe(false);
  });

  it("leaves sessions alone when the user's own --settings decides the theme", () => {
    useSettingsStore.getState().set({ claudeArgs: "--settings my.json" });
    expect(themeOutdated(workspace({ agentArgs: ["--resume", id, "--settings", "my.json"] }))).toBe(
      false,
    );
  });

  it("restarts only when Claude reports idle and nothing unsent would be lost", () => {
    expect(readyToRestart(workspace(), context())).toBe(true);
    expect(readyToRestart(workspace(), context({ live: [live("busy")] }))).toBe(false);
    expect(readyToRestart(workspace(), context({ live: [live("waiting")] }))).toBe(false);
    expect(readyToRestart(workspace(), context({ live: [live("shell")] }))).toBe(false);
    expect(readyToRestart(workspace(), context({ live: [] }))).toBe(false);
    expect(readyToRestart(workspace(), context({ terminal: terminal({ busy: true }) }))).toBe(
      false,
    );
    expect(readyToRestart(workspace(), context({ terminal: terminal({ status: "exited" }) }))).toBe(
      false,
    );
    expect(
      readyToRestart(workspace(), context({ input: { typedAt: now - 60_000, hasDraft: true } })),
    ).toBe(false);
    expect(
      readyToRestart(workspace(), context({ input: { typedAt: now - 1_000, hasDraft: false } })),
    ).toBe(false);
  });

  it("prefers the record of its own process over other copies of the session", () => {
    expect(readyToRestart(workspace(), context({ live: [live("idle"), live("busy", 7)] }))).toBe(
      true,
    );
    expect(readyToRestart(workspace(), context({ live: [live("busy"), live("idle", 7)] }))).toBe(
      false,
    );
    expect(readyToRestart(workspace(), context({ live: [live("idle", 7), live("busy", 8)] }))).toBe(
      false,
    );
  });

  it("never turns an unsaved fork or a used new session into a fresh one", () => {
    const unsaved = { filePath: null };
    expect(readyToRestart(workspace(unsaved), context())).toBe(false);
    const fresh = workspace({ ...unsaved, agentArgs: ["--session-id", id, ...dark] });
    expect(readyToRestart(fresh, context({ input: { typedAt: 0, hasDraft: false } }))).toBe(true);
    expect(readyToRestart(fresh, context())).toBe(false);
  });
});
