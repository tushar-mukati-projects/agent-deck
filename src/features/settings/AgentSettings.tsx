import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input, selectClass } from "@/components/ui/input";
import { useAgents } from "@/hooks/useAgents";
import { CLAUDE } from "@/lib/agents/registry";
import { newId } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import type { CustomAgent } from "@/types";

const CUSTOM_AGENT_ID_LENGTH = 8;

type DefaultAgentPickerProps = {
  id: string;
};

export const DefaultAgentPicker = ({ id }: DefaultAgentPickerProps) => {
  const defaultAgent = useSettingsStore((s) => s.defaultAgent);
  const agents = useAgents();
  return (
    <select
      id={id}
      value={agents.some((a) => a.id === defaultAgent) ? defaultAgent : CLAUDE}
      onChange={(e) => useSettingsStore.getState().set({ defaultAgent: e.target.value })}
      className={selectClass}
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
          <Input
            aria-label="Agent name"
            className="font-mono text-xs"
            value={agent.name}
            placeholder="Name"
            onChange={(e) => change(agent.id, { name: e.target.value })}
          />
          <Input
            aria-label="Agent command"
            className="font-mono text-xs"
            value={agent.command}
            placeholder="Command, e.g. gemini or aider --model sonnet"
            spellCheck={false}
            onChange={(e) => change(agent.id, { command: e.target.value })}
          />
          <IconButton
            label={`Remove ${agent.name || "agent"}`}
            onClick={() => useSettingsStore.getState().removeCustomAgent(agent.id)}
          >
            <Trash2 />
          </IconButton>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            update([
              ...agents,
              { id: newId().slice(0, CUSTOM_AGENT_ID_LENGTH), name: "", command: "" },
            ])
          }
        >
          <Plus /> Add agent
        </Button>
      </div>
    </div>
  );
};
