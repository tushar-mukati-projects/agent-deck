import { useState } from "react";

import { usePolling } from "@/hooks/usePolling";
import { api } from "@/lib/tauri/commands";
import type { TranscriptItem } from "@/types";

const LOCAL_POLL_MS = 1500;
const WSL_POLL_MS = 3000;

export const useSubagentTranscript = (
  filePath: string | null,
  distro: string | null,
  id: string,
) => {
  const [items, setItems] = useState<TranscriptItem[] | null>(null);
  const error = usePolling(
    filePath
      ? () => {
          let offset = 0;
          let loaded: TranscriptItem[] | null = null;
          return async (active) => {
            const page = await api.subagentTranscript(filePath, id, distro, offset);
            if (!active()) return;
            offset = page.offset;
            const changed = page.items.length > 0 || (page.reset && !!loaded?.length);
            if (!loaded || changed) {
              loaded = page.reset || !loaded ? page.items : [...loaded, ...page.items];
              setItems(loaded);
            }
          };
        }
      : null,
    distro ? WSL_POLL_MS : LOCAL_POLL_MS,
    [filePath, distro, id],
  );
  return { items, error };
};
