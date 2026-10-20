import { describe, expect, it } from "vitest";

import { blankWorkspace } from "@/stores/workspace-factory";
import { restoredWorkspace, restoreSaved } from "@/stores/workspace-persist";

describe("saved workspaces", () => {
  it("fills defaults and repairs the active file and tab", () => {
    const restored = restoreSaved({
      workspaces: [
        {
          id: "w",
          sessionId: "s",
          cwd: "C:\\repo",
          title: "t",
          openFiles: ["C:\\Repo\\A.ts"],
          activeFile: "c:\\repo\\a.ts",
        },
        {
          id: "v",
          sessionId: "s2",
          cwd: "C:\\x",
          title: "u",
          openFiles: ["C:\\x\\b.ts"],
          activeFile: "gone",
        },
      ],
      activeId: "missing",
    });
    expect(restored.activeId).toBe("w");
    expect(restored.workspaces[0]).toMatchObject({ agent: "claude", mode: "preview", shells: [] });
    expect(restored.workspaces[0].activeFile).toBe("c:\\repo\\a.ts");
    expect(restored.workspaces[1].activeFile).toBe("C:\\x\\b.ts");
  });

  it("handles missing or empty storage", () => {
    expect(restoreSaved(undefined)).toEqual({ workspaces: [], activeId: null });
    expect(restoreSaved({})).toEqual({ workspaces: [], activeId: null });
    expect(restoreSaved({ workspaces: [] })).toEqual({ workspaces: [], activeId: null });
  });

  it.each([
    ["a matched tab whose agent is gone", "C:\\s\\a.jsonl", false, null],
    ["an unmatched tab whose agent is gone", null, false, 1_000],
    ["an unmatched tab whose agent still runs", null, true, 1_000],
  ])("restores the pending start of %s", (_, filePath, running, pending) => {
    const saved = {
      ...blankWorkspace({ id: "w", sessionId: "s", cwd: "C:\\repo", title: "t", filePath }),
      agent: "codex",
      mode: "live" as const,
      agentTerminalId: "term",
      pendingSince: 1_000,
    };
    const restored = restoredWorkspace(saved, () => running);
    expect(restored.pendingSince).toBe(pending);
    expect(restored.mode).toBe(running ? "live" : "preview");
  });
});
