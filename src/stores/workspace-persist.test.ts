import { describe, expect, it } from "vitest";

import { restoreSaved } from "@/stores/workspace-persist";

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
  });
});
