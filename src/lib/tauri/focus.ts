import { appWindow } from "@/lib/tauri/system";

export const onWindowFocused = (callback: () => void) => {
  const unlisten = appWindow.onFocusChanged(({ payload: focused }) => {
    if (focused) callback();
  });
  return () => void unlisten.then((fn) => fn());
};
