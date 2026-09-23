import { listen } from "@tauri-apps/api/event";

import type { FsChange } from "@/types";

export const onSessionsChanged = (handler: () => void) => listen("sessions-changed", handler);

export const onFsChange = (handler: (change: FsChange) => void) =>
  listen<FsChange>("fs-change", (event) => handler(event.payload));
