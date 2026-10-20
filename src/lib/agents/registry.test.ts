import { describe, expect, it } from "vitest";

import { CODEX, findAgent, getAgent, listAgents } from "@/lib/agents/registry";
import { agentSettings } from "@/lib/agents/settings-fixture";
import type { AgentSettings } from "@/lib/agents/registry";

const id = "019a0000-0000-7000-8000-000000000001";

const themedClaude = (extra: Partial<AgentSettings>) =>
  findAgent("claude", agentSettings({ matchAgentTheme: true, ...extra }));

describe("agent registry", () => {
  it("builds Claude commands with its own session ids", () => {
    const claude = findAgent("claude", agentSettings());
    expect(claude.newArgs(id, { subagent: "reviewer" })).toEqual([
      "--session-id",
      id,
      "--agent",
      "reviewer",
    ]);
    expect(claude.resumeArgs(id)).toEqual(["--resume", id]);
    expect(claude.forkArgs(id, "new")).toEqual([
      "--resume",
      id,
      "--fork-session",
      "--session-id",
      "new",
    ]);
    expect(claude.assignsSessionIds).toBe(true);
  });

  it("builds Codex commands and learns ids from its files", () => {
    const codex = findAgent(CODEX, agentSettings({ codexArgs: "--model gpt-5" }));
    expect(codex.command).toEqual(["codex"]);
    expect(codex.newArgs(id, {})).toEqual([]);
    expect(codex.resumeArgs(id)).toEqual(["resume", id]);
    expect(codex.forkArgs(id, "ignored")).toEqual(["fork", id]);
    expect(codex.extraArgs()).toEqual(["--model", "gpt-5"]);
    expect(codex.assignsSessionIds).toBe(false);
  });

  it("adds custom agents without history", () => {
    const settings = agentSettings({
      customAgents: [
        { id: "g1", name: "", command: "gemini --yolo" },
        { id: "blank", name: "Empty", command: "  " },
      ],
    });
    const custom = listAgents(settings).filter((a) => a.id.startsWith("custom:"));
    expect(custom.map((a) => a.id)).toEqual(["custom:g1"]);
    expect(custom[0].name).toBe("gemini");
    expect(custom[0].command).toEqual(["gemini", "--yolo"]);
    expect(custom[0].history).toBe(false);
  });

  it("tells Claude to use the Deck theme's light or dark colors when Deck launches it", () => {
    const sakura = themedClaude({ themeId: "sakura" });
    expect(sakura.extraArgs({ deckTheme: true })).toEqual(["--settings", '{"theme":"light-ansi"}']);
    expect(sakura.extraArgs()).toEqual([]);
    const aurora = themedClaude({ themeId: "aurora" });
    expect(aurora.extraArgs({ deckTheme: true })).toEqual(["--settings", '{"theme":"dark-ansi"}']);
    const own = themedClaude({ themeId: "aurora", claudeArgs: "--settings my.json" });
    expect(own.extraArgs({ deckTheme: true })).toEqual(["--settings", "my.json"]);
  });

  it("falls back to Claude for display but reports removed agents", () => {
    expect(findAgent("custom:missing", agentSettings()).id).toBe("claude");
    expect(getAgent("custom:missing", agentSettings())).toBeNull();
  });
});
