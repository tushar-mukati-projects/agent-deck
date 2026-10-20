import { describe, expect, it } from "vitest";

import { agentCounts } from "@/lib/agent-counts";
import type { TerminalState } from "@/types";

const terminal = (id: string, extra: Partial<TerminalState> = {}): TerminalState => ({
  id,
  kind: "agent",
  status: "running",
  pid: 1,
  exitCode: null,
  error: null,
  busy: false,
  attention: false,
  ...extra,
});

describe("agentCounts", () => {
  it("counts running agents, then busy ones, then ones needing attention", () => {
    const terminals = Object.fromEntries(
      [
        terminal("a"),
        terminal("b", { busy: true }),
        terminal("c", { attention: true }),
        terminal("d", { kind: "shell", busy: true }),
        terminal("e", { status: "exited", busy: true }),
      ].map((t) => [t.id, t]),
    );
    expect(agentCounts(terminals)).toEqual([3, 1, 1]);
  });

  it("is all zero without terminals", () => {
    expect(agentCounts({})).toEqual([0, 0, 0]);
  });
});
