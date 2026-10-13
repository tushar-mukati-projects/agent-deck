import type { SettingsData } from "@/stores/settings-store";

export const HIDE_MODE_THEME = "one-dark";

export const appName = (hidden: boolean) => (hidden ? "Warp" : "Agent Deck");

type HideModeState = Pick<SettingsData, "hideMode" | "themeId" | "themeBeforeHide">;

export const hideModePatch = ({
  hideMode,
  themeId,
  themeBeforeHide,
}: HideModeState): HideModeState =>
  hideMode
    ? { hideMode: false, themeId: themeBeforeHide ?? themeId, themeBeforeHide: null }
    : { hideMode: true, themeId: HIDE_MODE_THEME, themeBeforeHide: themeId };
