import { useEffect } from "react";
import { create } from "zustand";

import { api } from "@/lib/tauri/commands";
import { appWindow } from "@/lib/tauri/system";
import { errorMessage, normalizePath } from "@/lib/utils";
import type { ClaudeOverview } from "@/types";

const FOCUS_REFRESH_MS = 30_000;
const MOUNT_REFRESH_MS = 5_000;

interface OverviewEntry {
  overview: ClaudeOverview | null;
  error: string | null;
  loading: boolean;
  fetchedAt: number;
}

interface OverviewState {
  entries: Record<string, OverviewEntry>;
  load: (cwd: string) => Promise<void>;
}

const EMPTY: OverviewEntry = { overview: null, error: null, loading: false, fetchedAt: 0 };
const inflight = new Map<string, Promise<void>>();

export const useOverviewStore = create<OverviewState>((set) => {
  const patch = (key: string, update: Partial<OverviewEntry>) =>
    set((s) => ({ entries: { ...s.entries, [key]: { ...(s.entries[key] ?? EMPTY), ...update } } }));

  return {
    entries: {},
    load: (cwd) => {
      const key = normalizePath(cwd);
      const running = inflight.get(key);
      if (running) return running;
      patch(key, { loading: true });
      const request = api
        .claudeOverview(cwd)
        .then(
          (overview) => patch(key, { overview, error: null }),
          (error: unknown) => patch(key, { error: errorMessage(error) }),
        )
        .finally(() => {
          inflight.delete(key);
          patch(key, { loading: false, fetchedAt: Date.now() });
        });
      inflight.set(key, request);
      return request;
    },
  };
});

export const refreshOverview = (cwd: string) => useOverviewStore.getState().load(cwd);

export const useOverview = (cwd: string) => {
  const key = normalizePath(cwd);
  const entry = useOverviewStore((s) => s.entries[key]) ?? EMPTY;

  useEffect(() => {
    const { load } = useOverviewStore.getState();
    const age = () => Date.now() - (useOverviewStore.getState().entries[key]?.fetchedAt ?? 0);
    if (age() > MOUNT_REFRESH_MS) void load(cwd);
    const unlisten = appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused && age() > FOCUS_REFRESH_MS) void load(cwd);
    });
    return () => void unlisten.then((fn) => fn());
  }, [cwd, key]);

  return { ...entry, reload: () => refreshOverview(cwd) };
};
