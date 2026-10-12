import { useCallback, useEffect, useState } from "react";

import { subscribeFileChanges } from "@/lib/file-events";
import { api } from "@/lib/tauri/commands";
import { appWindow } from "@/lib/tauri/system";
import { errorMessage, normalizePath } from "@/lib/utils";
import { isDirty } from "@/stores/viewer-store";
import type { FileContent } from "@/types";

type State =
  | { status: "loading" }
  | { status: "ready"; content: FileContent }
  | { status: "error"; error: string };

const CACHE_LIMIT = 40;
const cache = new Map<string, FileContent>();

const remember = (path: string, content: FileContent) => {
  const key = normalizePath(path);
  cache.delete(key);
  cache.set(key, content);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
};

const initialState = (path: string): State => {
  const cached = cache.get(normalizePath(path));
  return cached ? { status: "ready", content: cached } : { status: "loading" };
};

export const useFileContent = (path: string, enabled: boolean) => {
  const [state, setState] = useState<State>(() => initialState(path));
  const [staleOnDisk, setStaleOnDisk] = useState(false);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setState({ status: "loading" });
      try {
        const content = await api.readFile(path);
        remember(path, content);
        setState((current) =>
          current.status === "ready" &&
          current.content.kind === "text" &&
          content.kind === "text" &&
          current.content.modifiedMs === content.modifiedMs &&
          current.content.encoding === content.encoding &&
          current.content.size === content.size &&
          current.content.text === content.text
            ? current
            : { status: "ready", content },
        );
        setStaleOnDisk(false);
      } catch (error) {
        setState({ status: "error", error: errorMessage(error) });
      }
    },
    [path],
  );

  useEffect(() => {
    if (enabled) void load(cache.has(normalizePath(path)));
  }, [enabled, load, path]);

  useEffect(() => {
    if (!enabled) return;
    const target = normalizePath(path);
    const onChanged = () => {
      if (isDirty(path)) setStaleOnDisk(true);
      else void load(true);
    };
    const unsubscribe = subscribeFileChanges((change) => {
      if (change.paths.some((p) => normalizePath(p) === target)) onChanged();
    });
    const unlisten = appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused && !isDirty(path)) void load(true);
    });
    return () => {
      unsubscribe();
      void unlisten.then((fn) => fn());
    };
  }, [enabled, path, load]);

  return { state, reload: load, staleOnDisk, dismissStale: () => setStaleOnDisk(false) };
};

export const useFileVersion = (path: string) => {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const target = normalizePath(path);
    return subscribeFileChanges((change) => {
      if (change.paths.some((p) => normalizePath(p) === target)) setVersion((v) => v + 1);
    });
  }, [path]);
  return version;
};
