import { describe, expect, it } from "vitest";

import { agentSpec, planLaunch, resumeCommandLine } from "@/lib/agents/launch";
import { agentSettings, testLaunch } from "@/lib/agents/settings-fixture";
import { sessionInfo } from "@/lib/session-fixture";
import { blankWorkspace } from "@/stores/workspace-factory";
import type { Workspace } from "@/types";

const id = "00000000-0000-4000-8000-000000000001";

const workspace = (cwd: string, agent = "claude", extra: Partial<Workspace> = {}): Workspace => ({
  ...blankWorkspace({ id: "w", sessionId: id, cwd, title: "t", filePath: null, agent }),
  ...extra,
});

const session = (cwd: string, agent = "claude") => sessionInfo(id, { agent, cwd });

describe("launching agents", () => {
  it("starts new sessions and resumes saved ones", () => {
    expect(planLaunch(workspace("C:\\repo"), testLaunch())).toEqual({
      sessionId: id,
      args: ["--session-id", id],
      pending: false,
    });
    const saved = workspace("C:\\repo", "claude", { filePath: "C:\\x.jsonl" });
    expect(planLaunch(saved, testLaunch()).args).toEqual(["--resume", id]);
    const fork = planLaunch(saved, testLaunch(), { fork: true });
    expect(fork.sessionId).not.toBe(id);
    expect(fork.args.slice(0, 3)).toEqual(["--resume", id, "--fork-session"]);
    expect(planLaunch(workspace("C:\\repo", "codex"), testLaunch()).pending).toBe(true);
  });

  it("runs other agents through PowerShell in the workspace folder with their exit code", () => {
    const spec = agentSpec(
      { ...workspace("C:\\it's here", "codex"), agentTerminalId: "t", agentArgs: ["resume", id] },
      testLaunch(),
    );
    expect(spec.args.slice(0, 2)).toEqual(["-NoLogo", "-Command"]);
    expect(spec.args[2]).toBe(
      `Set-Location -LiteralPath 'C:\\it''s here'; & 'codex' 'resume' '${id}'; exit $LASTEXITCODE`,
    );
  });

  it("starts WSL agents through the user's login shell", () => {
    const spec = agentSpec(
      {
        ...workspace("\\\\wsl.localhost\\Debian\\home\\me\\my repo"),
        agentTerminalId: "t",
        agentArgs: ["--resume", id],
      },
      testLaunch(),
    );
    expect(spec.program).toBe("wsl.exe");
    expect(spec.args.slice(0, 7)).toEqual([
      "-d",
      "Debian",
      "--cd",
      "/home/me/my repo",
      "-e",
      "sh",
      "-c",
    ]);
    expect(spec.args[7]).toContain("getent passwd");
    expect(spec.args[8]).toBe(`exec claude --resume ${id}`);
  });

  it("copies resume commands that paste cleanly", () => {
    const terse = agentSettings({ claudeArgs: "--append-system-prompt 'be terse'" });
    expect(resumeCommandLine(session("C:\\Users\\me\\repo"), terse)).toBe(
      `Set-Location -LiteralPath 'C:\\Users\\me\\repo'; & claude --resume ${id} --append-system-prompt 'be terse'`,
    );
    const wslCodex = session("\\\\wsl.localhost\\Debian\\home\\me\\a b", "codex");
    expect(resumeCommandLine(wslCodex, agentSettings())).toBe(
      `cd '/home/me/a b' && codex resume ${id}`,
    );
  });
});
