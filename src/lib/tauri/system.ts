import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";

export const appWindow = getCurrentWindow();

export const pickFolder = async (defaultPath?: string) => {
  const selected = await open({ directory: true, multiple: false, defaultPath });
  return typeof selected === "string" ? selected : null;
};

export const assetUrl = (path: string) => convertFileSrc(path);

export const openExternal = (target: string) =>
  /^https?:\/\//i.test(target) ? openUrl(target) : openPath(target);

export const revealInExplorer = (path: string) => revealItemInDir(path);

export const copyText = (text: string) => navigator.clipboard.writeText(text);
