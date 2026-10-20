import * as registry from "@/lib/agents/registry";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { LaunchEnvironment } from "@/lib/agents/launch";
import type { AgentId } from "@/types";

const settings = () => useSettingsStore.getState();

export const launchEnvironment = (): LaunchEnvironment => {
  const { environment, byId } = useSessionsStore.getState();
  return { settings: settings(), environment, sessions: byId };
};

export const listAgents = () => registry.listAgents(settings());

export const getAgent = (id: AgentId | undefined) => registry.getAgent(id, settings());

export const findAgent = (id: AgentId | undefined) => registry.findAgent(id, settings());

export const agentName = (id: AgentId | undefined) => registry.agentName(id, settings());
