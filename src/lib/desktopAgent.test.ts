import { describe, expect, it } from "vitest";
import { DESKTOP_AGENT_OPT_IN_ID, protectedTerminalId } from "./desktopAgent";

describe("desktop agent ids", () => {
  it("marks every terminal with the protected prefix WinPilot looks for", () => {
    expect(protectedTerminalId("tm2")).toBe("winpilot-protected-terminal-tm2");
    expect(protectedTerminalId("a b:c/d")).toBe("winpilot-protected-terminal-a-b-c-d");
  });

  it("keeps the opt-in marker outside the protected prefix", () => {
    expect(DESKTOP_AGENT_OPT_IN_ID.startsWith("winpilot-protected")).toBe(false);
  });
});
