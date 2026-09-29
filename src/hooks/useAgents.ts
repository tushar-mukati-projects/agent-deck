import { useMemo } from "react";

import { listAgents } from "@/lib/agents/registry";
import { useSettingsStore } from "@/stores/settings-store";

export const useAgents = () => {
  const customAgents = useSettingsStore((s) => s.customAgents);
  return useMemo(() => listAgents(), [customAgents]);
};
