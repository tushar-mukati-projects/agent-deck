import { create } from "zustand";

import { liveSignature, mergeSessions, reuseSessions } from "@/lib/sessions";
import { singleFlight } from "@/lib/single-flight";
import { api } from "@/lib/tauri/commands";
import { errorMessage, sameJson } from "@/lib/utils";
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
  loadError: string | null;
  refreshing: boolean;
  distros: WslDistro[];
  wslLoading: boolean;
  wslErrors: Record<string, string>;
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

export const useSessionsStore = create<SessionsState>((set, get) => {
  let wslIndexed = false;

  const setLists = (windowsSessions: SessionInfo[], wslSessions: SessionInfo[]) => {
    const state = get();
    const merged = mergeSessions(withTitles(windowsSessions), withTitles(wslSessions));
    const sessions = reuseSessions(state.sessions, merged);
    set({
      windowsSessions,
      wslSessions,
      loaded: true,
      ...(sessions === state.sessions
        ? {}
        : { sessions, byId: Object.fromEntries(sessions.map((s) => [s.id, s])) }),
    });
  };

  const updateLists = (update: (list: SessionInfo[]) => SessionInfo[]) =>
    setLists(update(get().windowsSessions), update(get().wslSessions));

  const setLive = (live: LiveSession[]) => {
    if (liveSignature(live) !== liveSignature(get().live)) set({ live });
  };

  const refreshLive = singleFlight(async () => {
    const live = await api.liveSessions().catch(() => null);
    if (live) setLive(live);
  });

  const refresh = singleFlight(async () => {
    set({ refreshing: true });
    try {
      const [windowsSessions, live] = await Promise.all([api.listSessions(), api.liveSessions()]);
      setLists(windowsSessions, get().wslSessions);
      setLive(live);
      set({ loadError: null });
    } catch (error) {
      set({ loaded: true, loadError: errorMessage(error) });
    } finally {
      set({ refreshing: false });
    }
  });

  const setWslErrors = (wslErrors: Record<string, string>) => {
    if (!sameJson(wslErrors, get().wslErrors)) set({ wslErrors });
  };

  const clearWsl = () => {
    setWslErrors({});
    set({ wslLoading: false });
    if (get().wslSessions.length) setLists(get().windowsSessions, []);
  };

  const refreshWsl = singleFlight(async () => {
    if (!useSettingsStore.getState().includeWsl) return clearWsl();
    if (!wslIndexed) set({ wslLoading: true });
    try {
      const index = await api.listWslSessions();
      if (!sameJson(index.distros, get().distros)) set({ distros: index.distros });
      wslIndexed = true;
      if (!index.distros.some((d) => d.running)) return clearWsl();
      setWslErrors(index.errors);
      setLists(get().windowsSessions, index.sessions);
      await refreshLive();
    } catch (error) {
      setWslErrors({ WSL: errorMessage(error) });
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
    loadError: null,
    refreshing: false,
    distros: [],
    wslLoading: false,
    wslErrors: {},
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
        void refreshWsl();
      }
    },
    patchSession: (id, patch) =>
      updateLists((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s))),
    removeSession: (id) => updateLists((list) => list.filter((s) => s.id !== id)),
  };
});
