import { beforeEach, describe, expect, it } from "vitest";

import { CODEX, findAgent, listAgents } from "@/lib/agents/registry";
import { useSettingsStore } from "@/stores/settings-store";

const id = "019a0000-0000-7000-8000-000000000001";

describe("agent registry", () => {
  beforeEach(() =>
    useSettingsStore.getState().set({ claudeArgs: "", codexArgs: "", customAgents: [] }),
  );

  it("builds Claude commands with its own session ids", () => {
    const claude = findAgent("claude");
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
    useSettingsStore.getState().set({ codexArgs: "--model gpt-5" });
    const codex = findAgent(CODEX);
    expect(codex.command).toEqual(["codex"]);
    expect(codex.newArgs(id, {})).toEqual(["--model", "gpt-5"]);
    expect(codex.resumeArgs(id)).toEqual(["resume", id, "--model", "gpt-5"]);
    expect(codex.forkArgs(id, "ignored")).toEqual(["fork", id, "--model", "gpt-5"]);
    expect(codex.assignsSessionIds).toBe(false);
  });

  it("adds custom agents without history", () => {
    useSettingsStore.getState().set({
      customAgents: [
        { id: "g1", name: "Gemini", command: "gemini --yolo" },
        { id: "blank", name: "Empty", command: "  " },
      ],
    });
    const custom = listAgents().filter((a) => a.id.startsWith("custom:"));
    expect(custom.map((a) => a.id)).toEqual(["custom:g1"]);
    expect(custom[0].command).toEqual(["gemini", "--yolo"]);
    expect(custom[0].history).toBe(false);
  });

  it("falls back to Claude for unknown agents", () => {
    expect(findAgent("custom:missing").id).toBe("claude");
  });
});
