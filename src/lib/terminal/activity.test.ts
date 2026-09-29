import { describe, expect, it } from "vitest";

import { createActivity, noteInput } from "@/lib/terminal/activity";

type Owner = Parameters<typeof noteInput>[0];

const owner = () => ({ activity: createActivity() }) as unknown as Owner;

describe("terminal input tracking", () => {
  it("knows when a prompt has unsent text", () => {
    const o = owner();
    for (const key of ["h", "i", "é"]) noteInput(o, key);
    expect(o.activity.draft).toBe(3);
    noteInput(o, "\x7f");
    noteInput(o, "\x1b[D");
    expect(o.activity.draft).toBe(2);
    noteInput(o, "\r");
    expect(o.activity.draft).toBe(0);
    noteInput(o, "\x1b[200~pasted\x1b[201~");
    expect(o.activity.draft).toBe(1);
    noteInput(o, "\x03");
    expect(o.activity.draft).toBe(0);
  });

  it("ignores focus and mouse reports the terminal sends by itself", () => {
    const o = owner();
    for (const report of ["\x1b[I", "\x1b[O", "\x1b[<0;12;4M", "\x1b[<0;12;4m"])
      noteInput(o, report);
    expect(o.activity.typedAt).toBe(0);
    noteInput(o, "a");
    expect(o.activity.typedAt).toBeGreaterThan(0);
  });
});
