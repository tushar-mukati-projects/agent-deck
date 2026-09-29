import { create } from "zustand";

import { liveSignature, mergeSessions, sessionsSignature } from "@/lib/sessions";
import { singleFlight } from "@/lib/single-flight";
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

const withTitles = (sessions: SessionInfo[]) => {
  const titles = useSettingsStore.getState().sessionTitles;
  return sessions.map((s) =>
    titles[s.id] ? { ...s, title: titles[s.id], customTitle: titles[s.id] } : s,
  );
};

const merged = (windowsSessions: SessionInfo[], wslSessions: SessionInfo[]) =>
  mergeSessions(withTitles(windowsSessions), withTitles(wslSessions));

export const useSessionsStore = create<SessionsState>((set, get) => {
  const setSessions = (windowsSessions: SessionInfo[], wslSessions: SessionInfo[]) => {
    const state = get();
    const unchanged =
      sessionsSignature(windowsSessions) === sessionsSignature(state.windowsSessions) &&
      sessionsSignature(wslSessions) === sessionsSignature(state.wslSessions);
    if (unchanged && state.loaded) return;
    set({
      windowsSessions,
      wslSessions,
      loaded: true,
      ...merged(windowsSessions, wslSessions),
    });
  };

  const setLive = (live: LiveSession[]) => {
    if (liveSignature(live) !== liveSignature(get().live)) set({ live });
  };

  const refreshLive = singleFlight(async () => setLive(await api.liveSessions()));

  const refresh = singleFlight(async () => {
    set({ refreshing: true });
    try {
      const [windowsSessions, live] = await Promise.all([api.listSessions(), api.liveSessions()]);
      setSessions(windowsSessions, get().wslSessions);
      setLive(live);
    } finally {
      set({ refreshing: false });
    }
  });

  const refreshWsl = singleFlight(async () => {
    const clear = () => setSessions(get().windowsSessions, []);
    if (!useSettingsStore.getState().includeWsl) return clear();
    const distros = await api.wslDistros().catch(() => []);
    set({ distros });
    if (!distros.some((d) => d.running)) return clear();
    set({ wslLoading: get().wslSessions.length === 0 });
    try {
      const index = await api.listWslSessions();
      set({ wslErrors: index.errors, wslShells: index.shells });
      setSessions(get().windowsSessions, index.sessions);
      setLive(await api.liveSessions());
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
    refresh,
    refreshWsl,
    refreshLive,
    startDistro: async (name) => {
      set({ wslLoading: true });
      try {
        await api.wslStart(name);
      } finally {
        set({ wslLoading: false });
      }
      await refreshWsl();
    },
    patchSession: (id, patch) => {
      const apply = (list: SessionInfo[]) =>
        list.map((s) => (s.id === id ? { ...s, ...patch } : s));
      const windowsSessions = apply(get().windowsSessions);
      const wslSessions = apply(get().wslSessions);
      set({ windowsSessions, wslSessions, ...merged(windowsSessions, wslSessions) });
    },
    removeSession: (id) => {
      const windowsSessions = get().windowsSessions.filter((s) => s.id !== id);
      const wslSessions = get().wslSessions.filter((s) => s.id !== id);
      set({ windowsSessions, wslSessions, ...merged(windowsSessions, wslSessions) });
    },
  };
});
