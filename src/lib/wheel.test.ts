import { describe, expect, it } from "vitest";

import { clampScroll, glideStep, horizontalDelta } from "./wheel";

const px = (deltaX: number, deltaY: number) => ({ deltaX, deltaY, deltaMode: 0 });

describe("horizontalDelta", () => {
  it("turns a vertical wheel into a sideways scroll", () => {
    expect(horizontalDelta(px(0, 100), 300)).toBe(100);
    expect(horizontalDelta(px(0, -125), 300)).toBe(-125);
  });

  it("follows the dominant axis so finger drift never fights a swipe", () => {
    expect(horizontalDelta(px(13, -3), 300)).toBe(13);
    expect(horizontalDelta(px(-12, 2), 300)).toBe(-12);
    expect(horizontalDelta(px(2, 13), 300)).toBe(13);
  });

  it("converts line and page deltas to pixels", () => {
    expect(horizontalDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 300)).toBe(60);
    expect(horizontalDelta({ deltaX: 0, deltaY: -1, deltaMode: 2 }, 300)).toBe(-300);
  });
});

describe("clampScroll", () => {
  it("keeps the target inside the scrollable range", () => {
    expect(clampScroll(-20, 400)).toBe(0);
    expect(clampScroll(450, 400)).toBe(400);
    expect(clampScroll(120, 400)).toBe(120);
    expect(clampScroll(10, -5)).toBe(0);
  });
});

describe("glideStep", () => {
  it("eases toward the target and lands on it exactly", () => {
    let position = 0;
    let frames = 0;
    while (position !== 100 && frames < 100) {
      const next = glideStep(position, 100, 1000 / 60);
      expect(next).toBeGreaterThan(position);
      position = next;
      frames++;
    }
    expect(position).toBe(100);
    expect(frames).toBeLessThan(15);
  });

  it("covers the same distance at any refresh rate", () => {
    let slow = 0;
    let fast = 0;
    for (let i = 0; i < 6; i++) slow = glideStep(slow, 100, 1000 / 60);
    for (let i = 0; i < 15; i++) fast = glideStep(fast, 100, 1000 / 150);
    expect(Math.abs(slow - fast)).toBeLessThan(0.01);
  });

  it("works backwards too", () => {
    expect(glideStep(100, 0, 1000 / 60)).toBeCloseTo(60);
  });
});
