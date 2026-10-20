import type { TerminalState } from "@/types";

export const agentCounts = (terminals: Record<string, TerminalState>) => {
  const agents = Object.values(terminals).filter(
    (t) => t.kind === "agent" && t.status === "running",
  );
  return [
    agents.length,
    agents.filter((t) => t.busy).length,
    agents.filter((t) => t.attention).length,
  ];
};
