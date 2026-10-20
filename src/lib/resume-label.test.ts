import { describe, expect, it } from "vitest";

import { CLAUDE, CODEX } from "@/lib/agents/registry";
import { resumeLabel } from "@/lib/resume-label";

const claude = { id: CLAUDE, name: "Claude", history: true };
const codex = { id: CODEX, name: "Codex", history: true };
const custom = { id: "aider", name: "Aider", history: false };

describe("resumeLabel", () => {
  it.each([
    [claude, true, "Resume session"],
    [claude, false, "Start Claude"],
    [codex, true, "Resume in Codex"],
    [custom, true, "Start Aider"],
  ])("labels %j with persisted %s as %s", (agent, persisted, label) =>
    expect(resumeLabel(agent, persisted)).toBe(label),
  );
});
