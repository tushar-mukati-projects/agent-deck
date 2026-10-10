import { describe, expect, it } from "vitest";

import { alertStatus, announcement, newPhoneTopic, spokenTitle } from "@/lib/announce";

describe("spoken announcements", () => {
  it("says the session name, then the same status the notifications show", () => {
    expect(announcement("Over-ear headphones 2k-10k", "Claude", false)).toBe(
      "Over-ear headphones 2k-10k. Claude finished.",
    );
    expect(announcement("Fix flaky tests", "Codex", true)).toBe(
      "Fix flaky tests. Codex needs your approval.",
    );
    expect(alertStatus("Claude", false)).toBe("Claude finished");
  });

  it("keeps long titles short and drops symbols that sound odd", () => {
    expect(
      spokenTitle("claude-deck: Tauri desktop app for browsing Claude sessions on Windows"),
    ).toBe("claude-deck Tauri desktop app for browsing Claude sessions");
    expect(spokenTitle("Prices ₹2,000 → ₹10,000!!")).toBe("Prices 2 000 10 000");
  });

  it("falls back when the title has nothing speakable", () => {
    expect(announcement("→ ✓", "Claude", false)).toBe("Your session. Claude finished.");
  });
});

describe("phone topics", () => {
  it("are long, URL-safe and avoid look-alike characters", () => {
    const topic = newPhoneTopic((count) => Uint8Array.from({ length: count }, (_, i) => i * 7));
    expect(topic).toMatch(/^deck-[a-z2-9]{12}$/);
    expect(topic).not.toMatch(/[lo01]/);
  });
});
