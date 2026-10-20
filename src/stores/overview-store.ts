import { useCallback, useEffect } from "react";
import { create } from "zustand";

import { singleFlight } from "@/lib/single-flight";
import { api } from "@/lib/tauri/commands";
import { onWindowFocused } from "@/lib/tauri/system";
import { errorMessage, normalizePath, sameJson } from "@/lib/utils";
import type { AgentOverview, ConfigAgent } from "@/types";

const FOCUS_REFRESH_MS = 30_000;
const MOUNT_REFRESH_MS = 5_000;

interface OverviewEntry {
  overview: AgentOverview | null;
  error: string | null;
  loading: boolean;
  fetchedAt: number;
}

interface OverviewState {
  entries: Record<string, OverviewEntry>;
  load: (cwd: string, agent: ConfigAgent) => Promise<void>;
}

const EMPTY: OverviewEntry = { overview: null, error: null, loading: false, fetchedAt: 0 };
const loaders = new Map<string, () => Promise<void>>();

const entryKey = (cwd: string, agent: ConfigAgent) => `${agent}:${normalizePath(cwd)}`;

const useOverviewStore = create<OverviewState>((set, get) => {
  const patch = (key: string, update: Partial<OverviewEntry>) =>
    set((s) => ({ entries: { ...s.entries, [key]: { ...(s.entries[key] ?? EMPTY), ...update } } }));

  return {
    entries: {},
    load: (cwd, agent) => {
      const key = entryKey(cwd, agent);
      let loader = loaders.get(key);
      if (!loader) {
        loader = singleFlight(async () => {
          patch(key, { loading: true });
          try {
            const next = await api.agentOverview(cwd, agent);
            const current = get().entries[key]?.overview;
            const overview = current && sameJson(current, next) ? current : next;
            patch(key, { overview, error: null });
          } catch (error) {
            patch(key, { error: errorMessage(error) });
          } finally {
            patch(key, { loading: false, fetchedAt: Date.now() });
          }
        });
        loaders.set(key, loader);
      }
      return loader();
    },
  };
});

export const refreshOverview = (cwd: string, agent: ConfigAgent) =>
  useOverviewStore.getState().load(cwd, agent);

export const useOverview = (cwd: string, agent: ConfigAgent) => {
  const key = entryKey(cwd, agent);
  const entry = useOverviewStore((s) => s.entries[key]) ?? EMPTY;

  useEffect(() => {
    const { load } = useOverviewStore.getState();
    const age = () => Date.now() - (useOverviewStore.getState().entries[key]?.fetchedAt ?? 0);
    if (age() > MOUNT_REFRESH_MS) void load(cwd, agent);
    return onWindowFocused(() => {
      if (age() > FOCUS_REFRESH_MS) void load(cwd, agent);
    });
  }, [cwd, agent, key]);

  const reload = useCallback(() => refreshOverview(cwd, agent), [cwd, agent]);
  return { ...entry, reload };
};
