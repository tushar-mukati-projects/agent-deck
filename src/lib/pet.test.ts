import { describe, expect, it } from "vitest";

import { petLine, petMood } from "@/lib/pet";

describe("Deck pet", () => {
  it("naps when nothing is running and works while agents are busy", () => {
    expect(petMood(0, 0, false)).toBe("sleeping");
    expect(petMood(2, 0, false)).toBe("working");
  });

  it("celebrates a finished session even while others keep working", () => {
    expect(petMood(1, 0, true)).toBe("celebrating");
  });

  it("puts a session that needs you above everything else", () => {
    expect(petMood(3, 1, true)).toBe("waiting");
  });

  it("describes what it is doing with the right counts", () => {
    expect(petLine("working", 1, 0)).toBe("Deckie is working with you: 1 session busy.");
    expect(petLine("waiting", 0, 2)).toBe(
      "Deckie is waving: 2 sessions need you. Click to jump there.",
    );
    expect(petLine("sleeping", 0, 0)).toMatch(/napping/);
  });
});
