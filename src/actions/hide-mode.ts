import { hideModePatch } from "@/lib/hide-mode";
import { api } from "@/lib/tauri/commands";
import { useHideModeStore } from "@/stores/hide-mode-store";
import { useSettingsStore } from "@/stores/settings-store";

export const toggleHideMode = () => {
  const settings = useSettingsStore.getState();
  settings.set(hideModePatch(settings));
};

export const syncHideMode = async (enabled: boolean) => {
  const src = await api.applyHideMode(enabled);
  if (src) useHideModeStore.setState({ warpLogo: src });
};
