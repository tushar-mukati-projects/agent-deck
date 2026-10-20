import { hideModePatch } from "@/lib/hide-mode";
import { api } from "@/lib/tauri/commands";
import { useSettingsStore } from "@/stores/settings-store";
import { useWarpLogoStore } from "@/stores/warp-logo-store";

export const toggleHideMode = () => {
  const settings = useSettingsStore.getState();
  settings.set(hideModePatch(settings));
};

export const syncHideMode = async (enabled: boolean) => {
  const src = await api.applyHideMode(enabled);
  if (src) useWarpLogoStore.setState({ warpLogo: src });
};
