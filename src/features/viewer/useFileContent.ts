import { useCallback, useEffect, useState } from "react";

import { subscribeFileChanges } from "@/lib/file-events";
import { api } from "@/lib/tauri/commands";
import { errorMessage, samePath } from "@/lib/utils";
import { isDirty } from "@/stores/viewer-store";
import type { FileContent } from "@/types";

type State =
  | { status: "loading" }
  | { status: "ready"; content: FileContent; loadedAt: number }
  | { status: "error"; error: string };

export const useFileContent = (path: string, enabled: boolean) => {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setState({ status: "loading" });
      try {
        const content = await api.readFile(path);
        setState({ status: "ready", content, loadedAt: Date.now() });
      } catch (error) {
        setState({ status: "error", error: errorMessage(error) });
      }
    },
    [path],
  );

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) return;
    return subscribeFileChanges((change) => {
      if (change.paths.some((p) => samePath(p, path)) && !isDirty(path)) void load(true);
    });
  }, [enabled, path, load]);

  return { state, reload: load };
};
