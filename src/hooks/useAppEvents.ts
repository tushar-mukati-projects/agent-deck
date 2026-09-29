import { useEffect } from "react";

import { publishFileChange } from "@/lib/file-events";
import { onFsChange, onSessionsChanged } from "@/lib/tauri/events";
import { appWindow } from "@/lib/tauri/system";
import { useExplorerStore } from "@/stores/explorer-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const LIVE_POLL_MS = 15_000;
const WSL_POLL_MS = 10_000;

const runningAgentCount = () =>
  Object.values(useTerminalStore.getState().terminals).filter(
    (t) => t.kind === "agent" && (t.status === "running" || t.status === "starting"),
  ).length;

export const useAppEvents = () => {
  useEffect(() => {
    const { refresh, refreshLive, refreshWsl } = useSessionsStore.getState();
    const unlisteners = [
      onSessionsChanged(() => void refresh()),
      onFsChange((change) => {
        useExplorerStore.getState().refreshDirs(change.dirs);
        publishFileChange(change);
      }),
      appWindow.onCloseRequested(async (event) => {
        const running = runningAgentCount();
        if (running === 0) return;
        event.preventDefault();
        const confirmed = await useUiStore.getState().askConfirm({
          title: "Quit Claude Deck?",
          description: `${running} agent session${running > 1 ? "s are" : " is"} still running. Quitting stops ${running > 1 ? "them" : "it"} — conversations stay saved and can be resumed later.`,
          confirmLabel: "Quit",
          destructive: true,
        });
        if (confirmed) await appWindow.destroy();
      }),
    ];
    const poll = window.setInterval(() => void refreshLive(), LIVE_POLL_MS);
    const wslPoll = window.setInterval(() => {
      const { distros } = useSessionsStore.getState();
      if (
        useSettingsStore.getState().includeWsl &&
        distros.some((d) => d.running) &&
        !document.hidden
      )
        void refreshWsl();
    }, WSL_POLL_MS);
    const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
      if (state.includeWsl !== previous.includeWsl) void refreshWsl();
    });
    const unsubscribe = useSessionsStore.subscribe((state, previous) => {
      if (state.byId !== previous.byId) useWorkspaceStore.getState().syncSessions(state.byId);
    });
    return () => {
      window.clearInterval(poll);
      window.clearInterval(wslPoll);
      unsubscribeSettings();
      unsubscribe();
      unlisteners.forEach((p) => void p.then((fn) => fn()));
    };
  }, []);
};
