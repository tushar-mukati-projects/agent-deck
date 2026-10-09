import { useEffect, useState } from "react";

import { api } from "@/lib/tauri/commands";
import { errorMessage } from "@/lib/utils";
import type { TranscriptItem } from "@/types";

const LOCAL_POLL_MS = 1500;
const WSL_POLL_MS = 3000;

export const useSubagentTranscript = (
  filePath: string | null,
  distro: string | null,
  id: string,
) => {
  const [items, setItems] = useState<TranscriptItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) return;
    let cancelled = false;
    let timer: number | undefined;
    let offset = 0;
    let loaded: TranscriptItem[] | null = null;

    const poll = async () => {
      try {
        const page = await api.subagentTranscript(filePath, id, distro, offset);
        if (cancelled) return;
        offset = page.offset;
        const changed = page.items.length > 0 || (page.reset && !!loaded?.length);
        if (!loaded || changed) {
          loaded = page.reset || !loaded ? page.items : [...loaded, ...page.items];
          setItems(loaded);
        }
        setError(null);
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      }
      if (!cancelled)
        timer = window.setTimeout(() => void poll(), distro ? WSL_POLL_MS : LOCAL_POLL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [filePath, distro, id]);

  return { items, error };
};
