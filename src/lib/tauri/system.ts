import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

import { showError } from "@/components/ui/feedback";
import { api } from "@/lib/tauri/commands";

export const appWindow = getCurrentWindow();

export const pickFolder = async (defaultPath?: string) => {
  const selected = await open({ directory: true, multiple: false, defaultPath });
  return typeof selected === "string" ? selected : null;
};

export const assetUrl = (path: string) => convertFileSrc(path, "deckfile");

export const openExternal = (target: string) =>
  (/^(https?|mailto):/i.test(target) ? openUrl(target) : api.openPath(target)).catch(showError);

export const revealInExplorer = (path: string) => api.revealPath(path).catch(showError);

export const copyText = async (text: string, copiedMessage?: string) => {
  try {
    await navigator.clipboard.writeText(text);
    if (copiedMessage) toast.success(copiedMessage);
  } catch (error) {
    showError(error);
  }
};
