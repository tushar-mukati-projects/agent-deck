import { useEffect } from "react";
import { toast } from "sonner";

import { readyToRestart, themeOutdated } from "@/lib/agents/theme-restart";
import { terminalInput } from "@/lib/terminal/registry";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const SETTLE_MS = 1_200;
const RETRY_MS = 3_000;
const SLOW_RETRY_MS = 15_000;
const FAST_WINDOW_MS = 2 * 60_000;

const restartReady = () => {
  const { workspaces, restartAgent } = useWorkspaceStore.getState();
  const { live } = useSessionsStore.getState();
  const { terminals } = useTerminalStore.getState();
  const now = Date.now();
  const outdated = workspaces.filter(themeOutdated);
  const ready = outdated.filter((w) => {
    const id = w.agentTerminalId ?? "";
    return readyToRestart(w, { terminal: terminals[id], live, input: terminalInput(id), now });
  });
  ready.forEach((w) => restartAgent(w.id, false));
  if (ready.length)
    toast(
      ready.length === 1
        ? "Claude resumed with the new theme."
        : `${ready.length} Claude sessions resumed with the new theme.`,
    );
  return outdated.length - ready.length;
};

export const useAgentThemeSync = () => {
  useEffect(() => {
    let timer: number | undefined;
    let generation = 0;
    let changedAt = 0;

    const schedule = (run: number, delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void check(run), delay);
    };

    const check = async (run: number) => {
      if (!useWorkspaceStore.getState().workspaces.some(themeOutdated)) return;
      if (useUiStore.getState().settingsOpen) return;
      await useSessionsStore.getState().refreshLive();
      if (run !== generation || restartReady() === 0) return;
      schedule(run, Date.now() - changedAt < FAST_WINDOW_MS ? RETRY_MS : SLOW_RETRY_MS);
    };

    const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
      if (state.themeId === previous.themeId && state.matchAgentTheme === previous.matchAgentTheme)
        return;
      changedAt = Date.now();
      schedule(++generation, SETTLE_MS);
    });
    const unsubscribeUi = useUiStore.subscribe((state, previous) => {
      if (previous.settingsOpen && !state.settingsOpen && generation)
        schedule(generation, SETTLE_MS);
    });
    return () => {
      window.clearTimeout(timer);
      unsubscribeSettings();
      unsubscribeUi();
    };
  }, []);
};
