import { describe, expect, it } from "vitest";

import { pickVoice, voiceLabel, type VoiceLike } from "@/lib/speech";

const voice = (name: string, lang = "en-US", isDefault = false): VoiceLike => ({
  name,
  lang,
  default: isDefault,
});

const windows = [
  voice("Microsoft David - English (United States)", "en-US", true),
  voice("Microsoft Mark - English (United States)"),
  voice("Microsoft Zira - English (United States)"),
  voice("Microsoft Hortense - French (France)", "fr-FR"),
];

describe("voice choice", () => {
  it("prefers a female voice on a stock Windows install", () => {
    expect(pickVoice(windows, "")?.name).toBe("Microsoft Zira - English (United States)");
  });

  it("prefers a natural female voice when one is installed", () => {
    const natural = [
      ...windows,
      voice("Microsoft Aria Online (Natural) - English (United States)"),
    ];
    expect(pickVoice(natural, "")?.name).toMatch(/Aria/);
  });

  it("uses the voice you picked, and ignores voices for other languages", () => {
    expect(pickVoice(windows, "Microsoft Mark - English (United States)")?.name).toMatch(/Mark/);
    expect(pickVoice(windows, "Microsoft Hortense - French (France)")?.name).toMatch(/Zira/);
  });

  it("falls back to the default voice when no female voice exists", () => {
    expect(pickVoice(windows.slice(0, 2), "")?.name).toMatch(/David/);
  });

  it("shows short, readable names", () => {
    expect(voiceLabel("Microsoft Zira - English (United States)")).toBe(
      "Zira · English (United States)",
    );
  });
});
