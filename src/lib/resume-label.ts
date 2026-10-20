import { CLAUDE } from "@/lib/agents/registry";
import type { AgentId } from "@/types";

type LabelledAgent = {
  id: AgentId;
  name: string;
  history: boolean;
};

export const resumeLabel = (agent: LabelledAgent, persisted: boolean) => {
  if (!persisted || !agent.history) return `Start ${agent.name}`;
  return agent.id === CLAUDE ? "Resume session" : `Resume in ${agent.name}`;
};
