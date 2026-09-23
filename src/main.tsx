import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "@/App";
import { api } from "@/lib/tauri/commands";
import { appWindow } from "@/lib/tauri/system";
import { setRunningPtys } from "@/lib/terminal/registry";
import { applyTheme, findTheme } from "@/lib/themes";
import { useSettingsStore } from "@/stores/settings-store";
import { useSessionsStore } from "@/stores/sessions-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const loadFonts = () =>
  Promise.all([
    document.fonts.load('13px "JetBrains Mono Variable"'),
    document.fonts.load('600 13px "JetBrains Mono Variable"'),
    document.fonts.load('13px "Inter Variable"'),
  ]).catch(() => undefined);

applyTheme(findTheme(useSettingsStore.getState().themeId));
useSettingsStore.subscribe((state, previous) => {
  if (state.themeId !== previous.themeId) applyTheme(findTheme(state.themeId));
});

const bootstrap = async () => {
  const sessions = useSessionsStore.getState();
  const [ptys] = await Promise.all([
    api.ptyList().catch(() => []),
    sessions.loadEnvironment().catch(() => undefined),
    loadFonts(),
  ]);
  setRunningPtys(ptys.filter((p) => !p.exited).map((p) => p.id));
  useWorkspaceStore.getState().restore();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  requestAnimationFrame(() => void appWindow.show().then(() => appWindow.setFocus()));
  await sessions.refresh().catch(() => undefined);
  useWorkspaceStore.getState().syncTitles(useSessionsStore.getState().byId);
  await sessions.refreshWsl().catch(() => undefined);
};

bootstrap().catch(() => void appWindow.show());
