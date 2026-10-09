import { describe, expect, it } from "vitest";

import { captureAnchor, locateAnchor, type Rows } from "@/lib/terminal/scroll-anchor";

const rows = (lines: string[]): Rows => ({ count: lines.length, text: (row) => lines[row] ?? "" });

const transcript = (width: "wide" | "narrow") => {
  const intro = Array.from({ length: 40 }, (_, i) => `older message ${i}`);
  const paragraph =
    width === "wide"
      ? ["This is re-ranked with true over-ear fit and sound as the main factors."]
      : ["This is re-ranked with true over-ear fit", "and sound as the main factors."];
  const table = [
    "├────┼────┤",
    "│ 1  │ CMF Headphone Pro │",
    "├────┼────┤",
    "│ 2  │ boAt Nirvana │",
  ];
  const outro = Array.from({ length: 30 }, (_, i) => `later line ${i}`);
  return [...intro, ...paragraph, "", ...table, ...outro];
};

describe("scroll anchors", () => {
  it("finds the same text again after the transcript is reprinted at a new width", () => {
    const before = rows(transcript("wide"));
    const top = 40;
    const anchor = captureAnchor(before, top, 60);
    const after = rows(transcript("narrow"));
    expect(locateAnchor(after, anchor, 61)).toBe(40);
  });

  it("keeps the probe's offset when the top line itself was re-wrapped", () => {
    const before = rows(transcript("narrow"));
    const anchor = captureAnchor(before, 41, 61);
    const after = rows(transcript("wide"));
    expect(locateAnchor(after, anchor, 60)).toBe(40);
  });

  it("prefers the most distinctive probe over repeated table borders", () => {
    const lines = transcript("wide");
    const anchor = captureAnchor(rows(lines), 42, 60);
    expect(anchor.probes[0].text).toBe("├────┼────┤");
    const shifted = rows(["├────┼────┤", "filler", ...lines]);
    expect(locateAnchor(shifted, anchor, 62)).toBe(44);
  });

  it("falls back to the same relative position when nothing matches", () => {
    const anchor = captureAnchor(rows(transcript("wide")), 30, 60);
    const unrelated = rows(Array.from({ length: 200 }, (_, i) => `new ${i}`));
    expect(locateAnchor(unrelated, anchor, 180)).toBe(90);
  });

  it("skips blank and very short rows as probes", () => {
    const anchor = captureAnchor(rows(["", "  ", "ok", "a real line of text"]), 0, 10);
    expect(anchor.probes).toEqual([{ text: "a real line of text", offset: 3 }]);
  });
});
