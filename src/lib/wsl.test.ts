import { describe, expect, it } from "vitest";

import { parseWslPath, shellQuote } from "@/lib/wsl";

describe("wsl", () => {
  it("parses host paths", () => {
    expect(parseWslPath("\\\\wsl.localhost\\Debian\\home\\me")).toEqual({
      distro: "Debian",
      linuxPath: "/home/me",
    });
    expect(parseWslPath("C:\\Users")).toBeNull();
  });

  it("quotes shell arguments safely", () => {
    expect(shellQuote("--resume")).toBe("--resume");
    expect(shellQuote("it's")).toBe(`'it'"'"'s'`);
  });
});
