import { describe, expect, it } from "vitest";

import { announcement, newPhoneTopic, spokenTitle } from "@/lib/announce";

describe("spoken announcements", () => {
  it("says the session name and what happened", () => {
    expect(announcement("Over-ear headphones 2k-10k", false)).toBe(
      "Over-ear headphones 2k-10k is done.",
    );
    expect(announcement("Fix flaky tests", true)).toBe("Fix flaky tests needs your approval.");
  });

  it("keeps long titles short and drops symbols that sound odd", () => {
    expect(
      spokenTitle("claude-deck: Tauri desktop app for browsing Claude sessions on Windows"),
    ).toBe("claude-deck Tauri desktop app for browsing Claude sessions");
    expect(spokenTitle("Prices ₹2,000 → ₹10,000!!")).toBe("Prices 2 000 10 000");
  });

  it("falls back when the title has nothing speakable", () => {
    expect(announcement("→ ✓", false)).toBe("Your session is done.");
  });
});

describe("phone topics", () => {
  it("are long, URL-safe and avoid look-alike characters", () => {
    const topic = newPhoneTopic((count) => Uint8Array.from({ length: count }, (_, i) => i * 7));
    expect(topic).toMatch(/^deck-[a-z2-9]{12}$/);
    expect(topic).not.toMatch(/[lo01]/);
  });
});
