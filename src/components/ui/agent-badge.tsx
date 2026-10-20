import { cn } from "@/lib/utils";
import { agentName } from "@/stores/agents";
import type { AgentId } from "@/types";

export const AgentBadge = ({ agent, className }: { agent: AgentId; className?: string }) => (
  <span
    className={cn(
      "shrink-0 rounded border border-info/35 bg-info/10 px-1 text-[9.5px] leading-[14px] font-semibold tracking-wide text-info",
      className,
    )}
  >
    {agentName(agent)}
  </span>
);
