import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/tauri/commands";
import { lruSet } from "@/lib/utils";
import type { TranscriptItem } from "@/types";

const CACHE_LIMIT = 24;

interface Cached {
  stamp: number;
  offset: number;
  items: TranscriptItem[];
}

const cache = new Map<string, Cached>();

const fetchTranscript = async (filePath: string, distro: string | null, stamp: number) => {
  const hit = cache.get(filePath);
  if (hit && hit.stamp === stamp) return hit.items;
  const page = await api.sessionTranscript(filePath, distro, hit?.offset ?? 0);
  const items = page.reset || !hit ? page.items : [...hit.items, ...page.items];
  const latest = cache.get(filePath);
  if (!latest || latest.stamp <= stamp)
    lruSet(cache, filePath, { stamp, offset: page.offset, items }, CACHE_LIMIT);
  return items;
};

export const useTranscript = (
  filePath: string | null,
  distro: string | null,
  stamp: number,
  ready: boolean,
) => {
  const { data, error } = useAsync(
    () => (filePath ? fetchTranscript(filePath, distro, stamp) : Promise.resolve([])),
    [filePath, distro, stamp],
    { keepPrevious: true },
  );
  const cached = filePath ? cache.get(filePath)?.items : undefined;
  const items = cached ?? (filePath || ready ? (data ?? null) : null);
  return { items, error };
};
