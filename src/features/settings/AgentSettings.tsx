import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { listAgents } from "@/lib/agents/registry";
import { newId } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import type { CustomAgent } from "@/types";

const inputClass =
  "h-8 w-full rounded-md border border-border-strong bg-bg px-2.5 font-mono text-xs text-fg outline-none placeholder:text-faint focus:border-accent/70";

export const DefaultAgentPicker = () => {
  const defaultAgent = useSettingsStore((s) => s.defaultAgent);
  useSettingsStore((s) => s.customAgents);
  const agents = listAgents();
  return (
    <select
      value={agents.some((a) => a.id === defaultAgent) ? defaultAgent : "claude"}
      onChange={(e) => useSettingsStore.getState().set({ defaultAgent: e.target.value })}
      className="h-8 rounded-md border border-border-strong bg-bg px-2 text-xs text-fg outline-none focus:border-accent/70"
    >
      {agents.map((agent) => (
        <option key={agent.id} value={agent.id}>
          {agent.name}
        </option>
      ))}
    </select>
  );
};

export const CustomAgentsEditor = () => {
  const agents = useSettingsStore((s) => s.customAgents);
  const update = (next: CustomAgent[]) => useSettingsStore.getState().set({ customAgents: next });
  const change = (id: string, patch: Partial<CustomAgent>) =>
    update(agents.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  return (
    <div className="flex flex-col gap-1.5">
      {agents.map((agent) => (
        <div key={agent.id} className="grid grid-cols-[140px_1fr_auto] items-center gap-1.5">
          <input
            className={inputClass}
            value={agent.name}
            placeholder="Name"
            onChange={(e) => change(agent.id, { name: e.target.value })}
          />
          <input
            className={inputClass}
            value={agent.command}
            placeholder="Command, e.g. gemini or aider --model sonnet"
            spellCheck={false}
            onChange={(e) => change(agent.id, { command: e.target.value })}
          />
          <IconButton
            label={`Remove ${agent.name || "agent"}`}
            onClick={() => update(agents.filter((a) => a.id !== agent.id))}
          >
            <Trash2 />
          </IconButton>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => update([...agents, { id: newId().slice(0, 8), name: "", command: "" }])}
        >
          <Plus /> Add agent
        </Button>
      </div>
    </div>
  );
};
