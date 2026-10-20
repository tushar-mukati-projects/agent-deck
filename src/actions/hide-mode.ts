import { create } from "zustand";

import { showError } from "@/components/ui/feedback";
import { hideModePatch } from "@/lib/hide-mode";
import { api } from "@/lib/tauri/commands";
import { useSettingsStore } from "@/stores/settings-store";

export const useWarpLogo = create<{ src: string | null }>(() => ({ src: null }));

export const toggleHideMode = () => {
  const settings = useSettingsStore.getState();
  settings.set(hideModePatch(settings));
};

export const syncHideMode = async (enabled: boolean) => {
  try {
    const src = await api.applyHideMode(enabled);
    if (src) useWarpLogo.setState({ src });
  } catch (error) {
    showError(error);
  }
};
