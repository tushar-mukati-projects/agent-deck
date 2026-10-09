import { describe, expect, it } from "vitest";

import { contrast } from "@/lib/contrast";
import { ALL_THEMES } from "@/lib/themes";

const report = () =>
  ALL_THEMES.map((theme) => {
    const v = (name: string) => theme.vars[`--color-${name}`];
    return {
      id: theme.id,
      kind: theme.kind,
      fg: contrast(v("fg"), v("panel")),
      muted: contrast(v("muted"), v("panel")),
      fgOnChrome: contrast(v("fg"), v("chrome")),
      mutedOnChrome: contrast(v("muted"), v("chrome")),
      faint: contrast(v("faint"), v("panel")),
      border: contrast(v("border"), v("bg")),
      borderStrong: contrast(v("border-strong"), v("bg")),
      panelVsBg: contrast(v("panel"), v("bg")),
      accent: contrast(v("accent"), v("bg")),
      onAccent: contrast(v("on-accent"), v("accent")),
      danger: contrast(v("danger"), v("bg")),
      success: contrast(v("success"), v("bg")),
      warning: contrast(v("warning"), v("bg")),
      info: contrast(v("info"), v("bg")),
      comment: contrast(theme.vars["--syntax-comment"], v("code-bg")),
    };
  });

describe("theme contrast", () => {
  it.each(report())("$id keeps text and UI readable", (row) => {
    expect(row.fg).toBeGreaterThanOrEqual(7);
    expect(row.muted).toBeGreaterThanOrEqual(4.5);
    expect(row.fgOnChrome).toBeGreaterThanOrEqual(7);
    expect(row.mutedOnChrome).toBeGreaterThanOrEqual(4.5);
    expect(row.faint).toBeGreaterThanOrEqual(3.2);
    expect(row.accent).toBeGreaterThanOrEqual(3);
    expect(row.onAccent).toBeGreaterThanOrEqual(3);
    expect(row.danger).toBeGreaterThanOrEqual(3);
    expect(row.success).toBeGreaterThanOrEqual(3);
    expect(row.warning).toBeGreaterThanOrEqual(3);
    expect(row.info).toBeGreaterThanOrEqual(3);
    expect(row.comment).toBeGreaterThanOrEqual(3.2);
    expect(row.borderStrong).toBeGreaterThanOrEqual(1.25);
  });

  it.each(ALL_THEMES.filter((t) => t.kind === "light"))(
    "$id keeps ANSI white light so Claude's light prompt bars stay light",
    (theme) => {
      const { background, black, white, brightWhite } = theme.terminal;
      expect(contrast(white!, background!)).toBeLessThan(1.3);
      expect(contrast(brightWhite!, background!)).toBeLessThan(1.15);
      expect(contrast(black!, white!)).toBeGreaterThanOrEqual(theme.terminalContrast);
    },
  );

  it.each(ALL_THEMES.filter((t) => t.kind === "dark"))(
    "$id keeps ANSI bright black subtle so Claude's dark prompt bars stay subtle",
    (theme) => {
      const { background, brightBlack, brightWhite } = theme.terminal;
      expect(contrast(brightBlack!, background!)).toBeLessThan(1.8);
      expect(contrast(brightWhite!, brightBlack!)).toBeGreaterThanOrEqual(4.5);
      expect(theme.terminalContrast).toBeGreaterThanOrEqual(3);
    },
  );
});
