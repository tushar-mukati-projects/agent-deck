import { describe, expect, it } from "vitest";

import { sessionInfo } from "@/lib/session-fixture";
import { mergeSessions, reuseSessions } from "@/lib/sessions";
import type { SessionInfo } from "@/types";

const session = (id: string, modifiedMs: number, extra: Partial<SessionInfo> = {}) =>
  sessionInfo(id, { modifiedMs, ...extra });

describe("mergeSessions", () => {
  it("prefers the WSL copy and sorts newest first", () => {
    const merged = mergeSessions(
      [session("a", 1), session("b", 3)],
      [session("a", 2, { distro: "Debian" })],
    );
    expect(merged.map((s) => [s.id, s.distro])).toEqual([
      ["b", null],
      ["a", "Debian"],
    ]);
  });
});

describe("reuseSessions", () => {
  it("keeps the previous array when nothing changed", () => {
    const previous = [session("a", 2, { recentCwds: ["C:\\repo"] }), session("b", 1)];
    expect(
      reuseSessions(previous, [session("a", 2, { recentCwds: ["C:\\repo"] }), session("b", 1)]),
    ).toBe(previous);
    expect(
      reuseSessions(previous, [session("a", 2, { recentCwds: ["C:\\x"] }), session("b", 1)]),
    ).not.toBe(previous);
  });

  it("reuses unchanged objects and replaces changed ones", () => {
    const previous = [session("a", 2), session("b", 1)];
    const next = reuseSessions(previous, [session("b", 5), session("a", 2)]);
    expect(next).not.toBe(previous);
    expect(next[1]).toBe(previous[0]);
    expect(next[0]).not.toBe(previous[1]);
    expect(next[0].modifiedMs).toBe(5);
  });
});
