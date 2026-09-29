import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_THEME_ID } from "@/lib/themes";
import type { AgentId, CustomAgent } from "@/types";

export type ClickBehavior = "preview" | "resume";

export const DEFAULT_FONT_SIZE = 12;

interface SettingsState {
  claudeArgs: string;
  codexArgs: string;
  matchAgentTheme: boolean;
  defaultAgent: AgentId;
  agentFilter: AgentId | "all";
  customAgents: CustomAgent[];
  sessionTitles: Record<string, string>;
  shellProgram: string;
  fontSize: number;
  themeId: string;
  showHidden: boolean;
  clickBehavior: ClickBehavior;
  folderFilter: string | null;
  includeSubfolders: boolean;
  includeWsl: boolean;
  notifications: boolean;
  sound: boolean;
  pinnedSessions: string[];
  archivedSessions: string[];
  showArchived: boolean;
  togglePinned: (sessionId: string) => void;
  toggleArchived: (sessionId: string) => void;
  forgetSession: (sessionId: string) => void;
  setSessionTitle: (sessionId: string, title: string) => void;
  set: (
    patch: Partial<
      Omit<
        SettingsState,
        "set" | "togglePinned" | "toggleArchived" | "forgetSession" | "setSessionTitle"
      >
    >,
  ) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      claudeArgs: "",
      codexArgs: "",
      matchAgentTheme: true,
      defaultAgent: "claude",
      agentFilter: "all",
      customAgents: [],
      sessionTitles: {},
      shellProgram: "",
      fontSize: DEFAULT_FONT_SIZE,
      themeId: DEFAULT_THEME_ID,
      showHidden: true,
      clickBehavior: "preview",
      folderFilter: null,
      includeSubfolders: true,
      includeWsl: true,
      notifications: true,
      sound: true,
      pinnedSessions: [],
      archivedSessions: [],
      showArchived: false,
      togglePinned: (sessionId) => {
        const pinned = get().pinnedSessions;
        set({
          pinnedSessions: pinned.includes(sessionId)
            ? pinned.filter((id) => id !== sessionId)
            : [sessionId, ...pinned],
          archivedSessions: get().archivedSessions.filter((id) => id !== sessionId),
        });
      },
      toggleArchived: (sessionId) => {
        const archived = get().archivedSessions;
        set({
          archivedSessions: archived.includes(sessionId)
            ? archived.filter((id) => id !== sessionId)
            : [...archived, sessionId],
          pinnedSessions: get().pinnedSessions.filter((id) => id !== sessionId),
        });
      },
      setSessionTitle: (sessionId, title) =>
        set({ sessionTitles: { ...get().sessionTitles, [sessionId]: title } }),
      forgetSession: (sessionId) => {
        const { [sessionId]: _title, ...sessionTitles } = get().sessionTitles;
        set({
          pinnedSessions: get().pinnedSessions.filter((id) => id !== sessionId),
          archivedSessions: get().archivedSessions.filter((id) => id !== sessionId),
          sessionTitles,
        });
      },
      set: (patch) => set(patch),
    }),
    {
      name: "claude-deck-settings",
      version: 1,
      migrate: (persisted, version) => {
        const state = persisted as Partial<SettingsState>;
        if (version < 1 && state.fontSize === 13) state.fontSize = DEFAULT_FONT_SIZE;
        return state as SettingsState;
      },
    },
  ),
);
