import type { SessionInfo } from "@/types";

export const sessionInfo = (id: string, extra: Partial<SessionInfo> = {}): SessionInfo => ({
  id,
  agent: "claude",
  distro: null,
  filePath: `C:\\s\\${id}.jsonl`,
  cwd: "C:\\repo",
  title: id,
  customTitle: null,
  firstPrompt: null,
  lastPrompt: null,
  gitBranch: null,
  startedAt: null,
  modifiedMs: 0,
  promptCount: 1,
  size: 10,
  version: null,
  recentCwds: [],
  ...extra,
});
