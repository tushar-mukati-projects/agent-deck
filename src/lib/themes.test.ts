import { describe, expect, it } from "vitest";

import { contrast } from "@/lib/contrast";
import { THEMES } from "@/lib/themes";

const report = () =>
  THEMES.map((theme) => {
    const v = (name: string) => theme.vars[`--color-${name}`];
    return {
      id: theme.id,
      kind: theme.kind,
      fg: contrast(v("fg"), v("panel")),
      muted: contrast(v("muted"), v("panel")),
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
});
