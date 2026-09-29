import { useAsync } from "@/hooks/useAsync";
import { api } from "@/lib/tauri/commands";
import type { TranscriptItem } from "@/types";

const CACHE_LIMIT = 24;

interface Cached {
  stamp: number;
  offset: number;
  items: TranscriptItem[];
}

const cache = new Map<string, Cached>();

const remember = (filePath: string, entry: Cached) => {
  const current = cache.get(filePath);
  if (current && current.stamp > entry.stamp) return;
  cache.delete(filePath);
  cache.set(filePath, entry);
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
};

const fetchTranscript = async (filePath: string, distro: string | null, stamp: number) => {
  const hit = cache.get(filePath);
  if (hit && hit.stamp === stamp) return hit.items;
  const page = await api.sessionTranscript(filePath, distro, hit?.offset ?? 0);
  const items = page.reset || !hit ? page.items : [...hit.items, ...page.items];
  remember(filePath, { stamp, offset: page.offset, items });
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
