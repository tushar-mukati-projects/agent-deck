import { create } from "zustand";
import { persist } from "zustand/middleware";

import { customAgentId } from "@/lib/agents/registry";
import { DEFAULT_THEME_ID } from "@/lib/themes";
import { omitKey } from "@/lib/utils";
import type { AgentId, CustomAgent } from "@/types";

export type ClickBehavior = "preview" | "resume";

const SETTINGS_STORAGE_KEY = "agent-deck-settings";

export const DEFAULT_FONT_SIZE = 12;
export const MIN_FONT_SIZE_PX = 9;
export const MAX_FONT_SIZE_PX = 22;

export interface SettingsData {
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
  speech: boolean;
  voice: string;
  phonePing: boolean;
  phoneTopic: string;
  pet: boolean;
  hideMode: boolean;
  themeBeforeHide: string | null;
  pinnedSessions: string[];
  archivedSessions: string[];
  showArchived: boolean;
}

interface SettingsState extends SettingsData {
  togglePinned: (sessionId: string) => void;
  toggleArchived: (sessionId: string) => void;
  forgetSession: (sessionId: string) => void;
  setSessionTitle: (sessionId: string, title: string) => void;
  removeCustomAgent: (agentId: string) => void;
  set: (patch: Partial<SettingsData>) => void;
}

const DEFAULTS: SettingsData = {
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
  speech: true,
  voice: "",
  phonePing: false,
  phoneTopic: "",
  pet: true,
  hideMode: false,
  themeBeforeHide: null,
  pinnedSessions: [],
  archivedSessions: [],
  showArchived: false,
};

const without = (ids: string[], id: string) => ids.filter((other) => other !== id);

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULTS,
      togglePinned: (sessionId) => {
        const pinned = get().pinnedSessions;
        set({
          pinnedSessions: pinned.includes(sessionId)
            ? without(pinned, sessionId)
            : [sessionId, ...pinned],
          archivedSessions: without(get().archivedSessions, sessionId),
        });
      },
      toggleArchived: (sessionId) => {
        const archived = get().archivedSessions;
        set({
          archivedSessions: archived.includes(sessionId)
            ? without(archived, sessionId)
            : [...archived, sessionId],
          pinnedSessions: without(get().pinnedSessions, sessionId),
        });
      },
      setSessionTitle: (sessionId, title) =>
        set({ sessionTitles: { ...get().sessionTitles, [sessionId]: title } }),
      forgetSession: (sessionId) =>
        set({
          pinnedSessions: without(get().pinnedSessions, sessionId),
          archivedSessions: without(get().archivedSessions, sessionId),
          sessionTitles: omitKey(get().sessionTitles, sessionId),
        }),
      removeCustomAgent: (agentId) => {
        const id = customAgentId(agentId);
        const { customAgents, defaultAgent, agentFilter } = get();
        set({
          customAgents: customAgents.filter((a) => a.id !== agentId),
          ...(defaultAgent === id ? { defaultAgent: DEFAULTS.defaultAgent } : {}),
          ...(agentFilter === id ? { agentFilter: DEFAULTS.agentFilter } : {}),
        });
      },
      set: (patch) => set(patch),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      version: 1,
    },
  ),
);
