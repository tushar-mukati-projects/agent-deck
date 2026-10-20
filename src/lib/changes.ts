import { CLAUDE } from "@/lib/agents/registry";
import type { DiffTab } from "@/lib/diff-tabs";
import type { AgentId, ChangedFile, ChangeStatus } from "@/types";

const NOT_A_REPO = /not a git repository/i;

export const gitChangeStatus = (code: string): ChangeStatus => {
  if (code === "??" || code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  return "modified";
};

export const gitMessage = (error: string) =>
  NOT_A_REPO.test(error) ? "Not a git repository." : error;

export const changeDiffSource = (file: ChangedFile, agent: AgentId): DiffTab["source"] =>
  file.backup || agent === CLAUDE ? "session" : "git";
