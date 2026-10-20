import { useEffect, useState } from "react";

import { MIN_CHAT_QUERY } from "@/lib/palette";
import { api } from "@/lib/tauri/commands";
import { failedTo } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import type { SearchHit } from "@/types";

const CHAT_SEARCH_DELAY_MS = 250;

export const useChatSearch = (query: string, enabled: boolean) => {
  const includeWsl = useSettingsStore((s) => s.includeWsl);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    setError(null);
    if (!enabled || query.length < MIN_CHAT_QUERY) {
      setHits(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(() => {
      api
        .searchSessions(query, includeWsl)
        .then((result) => !cancelled && setHits(result))
        .catch((reason: unknown) => {
          if (cancelled) return;
          setHits([]);
          setError(failedTo("search conversations", reason));
        })
        .finally(() => !cancelled && setSearching(false));
    }, CHAT_SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, enabled, includeWsl]);
  return { hits, error, searching };
};
