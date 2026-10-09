import { describe, expect, it } from "vitest";

import {
  cleanOutput,
  processStart,
  runningSubagents,
  shownTasks,
  subagentLabel,
  taskState,
} from "@/lib/agent-tasks";
import type { AgentTask, LiveSession, Subagent } from "@/types";

const NOW = Date.parse("2026-09-29T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const START = NOW - 60 * 60_000;

const task = (
  id: string,
  status: AgentTask["status"],
  startedMinutesAgo: number,
  endedMinutesAgo: number | null = null,
): AgentTask => ({
  id,
  tool: "Bash",
  command: `run ${id}`,
  description: null,
  outputPath: null,
  startedAt: ago(startedMinutesAgo),
  endedAt: endedMinutesAgo === null ? null : ago(endedMinutesAgo),
  status,
  summary: null,
});

describe("agent shells", () => {
  it("shows this run's running shells and recently finished ones", () => {
    const tasks = [
      task("a", "running", 10),
      task("b", "completed", 20, 5),
      task("c", "failed", 50, 45),
      task("old", "running", 120),
    ];
    expect(shownTasks(tasks, START, NOW).map((t) => t.id)).toEqual(["a", "b"]);
    expect(shownTasks(tasks, null, NOW)).toEqual([]);
  });

  it("hides finished shells the user closed without bringing older ones back", () => {
    const finished = Array.from({ length: 7 }, (_, i) => task(`f${i}`, "completed", 20, 5 + i));
    const shown = shownTasks([task("a", "running", 10), ...finished], START, NOW, ["f0", "a"]);
    expect(shown.map((t) => t.id)).toEqual(["a", "f1", "f2", "f3", "f4"]);
  });

  it("treats shells from an earlier run, or with the agent gone, as ended", () => {
    expect(taskState(task("old", "running", 120), START)).toBe("ended");
    expect(taskState(task("a", "running", 10), START)).toBe("running");
    expect(taskState(task("a", "running", 10), null)).toBe("ended");
    expect(taskState(task("b", "killed", 10, 1), null)).toBe("killed");
  });

  it("finds when the agent process started from its live records", () => {
    const live = [
      { sessionId: "s", startedAt: 5 },
      { sessionId: "s", startedAt: 9 },
      { sessionId: "x", startedAt: 99 },
    ] as LiveSession[];
    expect(processStart(live, "s")).toBe(9);
    expect(processStart(live, "none")).toBe(0);
  });

  it("strips colors and keeps the last carriage-return frame of each line", () => {
    expect(cleanOutput("\x1b[32mok\x1b[0m\r\nbuild 10%\rbuild 100%\n\n")).toBe(
      "ok\nbuild 100%\n\n",
    );
    expect(cleanOutput("\x1b]0;title\x07plain")).toBe("plain");
  });
});

const subagent = (id: string, status: Subagent["status"], startedMinutesAgo: number): Subagent => ({
  id,
  agentId: `agent-${id}`,
  description: `Research ${id}`,
  agentType: "general-purpose",
  startedAt: ago(startedMinutesAgo),
  endedAt: null,
  status,
});

describe("subagents", () => {
  it("lists only this run's running subagents, oldest first", () => {
    const agents = [
      subagent("new", "running", 5),
      subagent("done", "completed", 8),
      subagent("old", "running", 30),
      subagent("stale", "running", 120),
    ];
    expect(runningSubagents(agents, START).map((a) => a.id)).toEqual(["old", "new"]);
    expect(runningSubagents(agents, null)).toEqual([]);
  });

  it("labels subagents by description, then type", () => {
    const base = subagent("a", "running", 1);
    expect(subagentLabel(base)).toBe("Research a");
    expect(subagentLabel({ ...base, description: " " })).toBe("general-purpose");
    expect(subagentLabel({ ...base, description: null, agentType: null })).toBe("Subagent");
  });
});
