import { create } from "zustand";

import { api } from "@/lib/tauri/commands";
import { errorMessage } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import type { AppEnvironment, LiveSession, SessionInfo, WslDistro } from "@/types";

interface SessionsState {
  environment: AppEnvironment | null;
  windowsSessions: SessionInfo[];
  wslSessions: SessionInfo[];
  sessions: SessionInfo[];
  byId: Record<string, SessionInfo>;
  live: LiveSession[];
  loaded: boolean;
  refreshing: boolean;
  distros: WslDistro[];
  wslLoading: boolean;
  wslErrors: Record<string, string>;
  wslShells: Record<string, string>;
  loadEnvironment: () => Promise<void>;
  refresh: () => Promise<void>;
  refreshWsl: () => Promise<void>;
  refreshLive: () => Promise<void>;
  startDistro: (name: string) => Promise<void>;
  removeSession: (id: string) => void;
  patchSession: (id: string, patch: Partial<SessionInfo>) => void;
}

const merge = (windows: SessionInfo[], wsl: SessionInfo[]) => {
  const wslIds = new Set(wsl.map((s) => s.id));
  const sessions = [...wsl, ...windows.filter((s) => !wslIds.has(s.id))].sort(
    (a, b) => b.modifiedMs - a.modifiedMs,
  );
  return { sessions, byId: Object.fromEntries(sessions.map((s) => [s.id, s])) };
};

const singleFlight = (run: () => Promise<void>) => {
  let inflight: Promise<void> | null = null;
  let queued = false;
  const trigger = (): Promise<void> => {
    if (inflight) {
      queued = true;
      return inflight;
    }
    inflight = run().finally(() => {
      inflight = null;
      if (queued) {
        queued = false;
        void trigger();
      }
    });
    return inflight;
  };
  return trigger;
};

export const useSessionsStore = create<SessionsState>((set, get) => {
  const refreshWindows = singleFlight(async () => {
    set({ refreshing: true });
    try {
      const [windowsSessions, live] = await Promise.all([api.listSessions(), api.liveSessions()]);
      set({ windowsSessions, live, loaded: true, ...merge(windowsSessions, get().wslSessions) });
    } finally {
      set({ refreshing: false });
    }
  });

  const refreshWslIndex = singleFlight(async () => {
    if (!useSettingsStore.getState().includeWsl) {
      set({ wslSessions: [], ...merge(get().windowsSessions, []) });
      return;
    }
    const distros = await api.wslDistros().catch(() => []);
    set({ distros });
    if (!distros.some((d) => d.running)) {
      set({ wslSessions: [], ...merge(get().windowsSessions, []) });
      return;
    }
    set({ wslLoading: get().wslSessions.length === 0 });
    try {
      const index = await api.listWslSessions();
      const live = await api.liveSessions();
      set({
        wslSessions: index.sessions,
        wslErrors: index.errors,
        wslShells: index.shells,
        live,
        ...merge(get().windowsSessions, index.sessions),
      });
    } catch (error) {
      set({ wslErrors: { WSL: errorMessage(error) } });
    } finally {
      set({ wslLoading: false });
    }
  });

  return {
    environment: null,
    windowsSessions: [],
    wslSessions: [],
    sessions: [],
    byId: {},
    live: [],
    loaded: false,
    refreshing: false,
    distros: [],
    wslLoading: false,
    wslErrors: {},
    wslShells: {},
    loadEnvironment: async () => set({ environment: await api.environment() }),
    refresh: refreshWindows,
    refreshWsl: refreshWslIndex,
    refreshLive: async () => set({ live: await api.liveSessions() }),
    startDistro: async (name) => {
      set({ wslLoading: true });
      try {
        await api.wslStart(name);
      } finally {
        set({ wslLoading: false });
      }
      await refreshWslIndex();
    },
    patchSession: (id, patch) => {
      const apply = (list: SessionInfo[]) => list.map((s) => (s.id === id ? { ...s, ...patch } : s));
      const windowsSessions = apply(get().windowsSessions);
      const wslSessions = apply(get().wslSessions);
      set({ windowsSessions, wslSessions, ...merge(windowsSessions, wslSessions) });
    },
    removeSession: (id) => {
      const windowsSessions = get().windowsSessions.filter((s) => s.id !== id);
      const wslSessions = get().wslSessions.filter((s) => s.id !== id);
      set({ windowsSessions, wslSessions, ...merge(windowsSessions, wslSessions) });
    },
  };
});
