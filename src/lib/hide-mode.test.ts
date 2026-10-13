import { describe, expect, it } from "vitest";

import { appName, HIDE_MODE_THEME, hideModePatch } from "@/lib/hide-mode";
import { findTheme } from "@/lib/themes";

describe("hide mode", () => {
  it("switches to One Dark and restores the previous theme", () => {
    const hidden = hideModePatch({ hideMode: false, themeId: "rainforest", themeBeforeHide: null });
    expect(hidden).toEqual({
      hideMode: true,
      themeId: HIDE_MODE_THEME,
      themeBeforeHide: "rainforest",
    });
    expect(hideModePatch(hidden)).toEqual({
      hideMode: false,
      themeId: "rainforest",
      themeBeforeHide: null,
    });
  });

  it("keeps the current theme when nothing was saved", () => {
    expect(hideModePatch({ hideMode: true, themeId: "aqua", themeBeforeHide: null }).themeId).toBe(
      "aqua",
    );
  });

  it("uses a theme that exists and the disguised name", () => {
    expect(findTheme(HIDE_MODE_THEME).id).toBe(HIDE_MODE_THEME);
    expect(appName(true)).toBe("Warp");
    expect(appName(false)).toBe("Agent Deck");
  });
});
