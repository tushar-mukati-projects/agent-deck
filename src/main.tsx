import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { openPathFromTerminal } from "@/actions/files";
import { App } from "@/App";
import { suppressBrowserChrome } from "@/lib/browser-chrome";
import { api } from "@/lib/tauri/commands";
import { appWindow } from "@/lib/tauri/system";
import { setPathLinkHandler, setRunningPtys } from "@/lib/terminal/registry";
import { applyTheme, findTheme } from "@/lib/themes";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { referencedTerminalIds, useWorkspaceStore } from "@/stores/workspace-store";

suppressBrowserChrome();
applyTheme(findTheme(useSettingsStore.getState().themeId));
useSettingsStore.subscribe((state, previous) => {
  if (state.themeId !== previous.themeId) applyTheme(findTheme(state.themeId));
});
setPathLinkHandler((workspaceId, target) => void openPathFromTerminal(workspaceId, target));

const loadFonts = () =>
  Promise.all([
    document.fonts.load('13px "JetBrains Mono Variable"'),
    document.fonts.load('600 13px "JetBrains Mono Variable"'),
    document.fonts.load('13px "Inter Variable"'),
  ]).catch(() => undefined);

const reattachTerminals = async () => {
  const ptys = await api.ptyList().catch(() => []);
  setRunningPtys(ptys.filter((p) => !p.exited).map((p) => p.id));
  useWorkspaceStore.getState().restore();
  const referenced = referencedTerminalIds();
  await Promise.all(
    ptys.filter((p) => !referenced.has(p.id)).map((p) => api.ptyKill(p.id).catch(() => undefined)),
  );
};

const render = () =>
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

const bootstrap = async () => {
  const sessions = useSessionsStore.getState();
  try {
    await Promise.all([
      reattachTerminals(),
      sessions.loadEnvironment().catch(() => undefined),
      loadFonts(),
    ]);
  } finally {
    render();
    requestAnimationFrame(() => void appWindow.show().then(() => appWindow.setFocus()));
  }
  await sessions.refresh().catch(() => undefined);
  await sessions.refreshWsl().catch(() => undefined);
};

void bootstrap();
