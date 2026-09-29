import { useEffect } from "react";

import { confirmQuit } from "@/actions/workspaces";
import { publishFileChange, watchedRoots } from "@/lib/file-events";
import { api } from "@/lib/tauri/commands";
import { onFsChange, onSessionsChanged } from "@/lib/tauri/events";
import { appWindow } from "@/lib/tauri/system";
import { useExplorerStore } from "@/stores/explorer-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const LIVE_POLL_MS = 15_000;
const WSL_TICK_MS = 10_000;
const WSL_IDLE_MS = 60_000;

const wslPollDue = (lastRun: number) => {
  const { distros } = useSessionsStore.getState();
  const active = document.hasFocus() && distros.some((d) => d.running);
  return Date.now() - lastRun >= (active ? WSL_TICK_MS : WSL_IDLE_MS);
};

export const useAppEvents = () => {
  useEffect(() => {
    const sessions = useSessionsStore.getState();
    let lastWsl = Date.now();
    const refreshWsl = () => {
      lastWsl = Date.now();
      void sessions.refreshWsl();
    };

    const unlisteners = [
      onSessionsChanged(() => void sessions.refresh()),
      onFsChange((change) => {
        const explorer = useExplorerStore.getState();
        if (change.rescan) explorer.refreshWithin(change.root);
        else explorer.refreshDirs(change.dirs);
        publishFileChange(change);
      }),
      appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        if (await confirmQuit()) await appWindow.destroy();
      }),
      appWindow.onFocusChanged(({ payload: focused }) => {
        if (!focused) return;
        for (const root of watchedRoots()) void api.watchDir(root).catch(() => undefined);
        if (Date.now() - lastWsl >= WSL_TICK_MS && useSettingsStore.getState().includeWsl)
          refreshWsl();
      }),
    ];
    const livePoll = window.setInterval(() => void sessions.refreshLive(), LIVE_POLL_MS);
    const wslPoll = window.setInterval(() => {
      if (useSettingsStore.getState().includeWsl && !document.hidden && wslPollDue(lastWsl))
        refreshWsl();
    }, WSL_TICK_MS);
    const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
      if (state.includeWsl !== previous.includeWsl) refreshWsl();
    });
    const syncSessions = () =>
      useWorkspaceStore.getState().syncSessions(useSessionsStore.getState().byId);
    syncSessions();
    const unsubscribeSessions = useSessionsStore.subscribe((state, previous) => {
      if (state.byId !== previous.byId) syncSessions();
    });
    return () => {
      window.clearInterval(livePoll);
      window.clearInterval(wslPoll);
      unsubscribeSettings();
      unsubscribeSessions();
      unlisteners.forEach((p) => void p.then((fn) => fn()));
    };
  }, []);
};
