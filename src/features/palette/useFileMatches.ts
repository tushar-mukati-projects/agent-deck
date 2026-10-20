import { useEffect, useMemo, useRef, useState } from "react";

import { useAsync } from "@/hooks/useAsync";
import { subscribeFileChanges, watchedSince } from "@/lib/file-events";
import { pathKey } from "@/lib/fuzzy";
import { topFiles, type PreparedFile } from "@/lib/palette";
import { api } from "@/lib/tauri/commands";
import { failedTo, normalizePath } from "@/lib/utils";

const FILE_CACHE_MS = 5 * 60_000;
const UNWATCHED_FILE_CACHE_MS = 20_000;
const fileCache = new Map<string, { at: number; files: string[] }>();
const filesChangedAt = new Map<string, number>();

subscribeFileChanges((change) => filesChangedAt.set(normalizePath(change.root), Date.now()));

interface FileNarrowing {
  files: PreparedFile[];
  query: string;
  matched: PreparedFile[];
}

export const useFileMatches = (
  root: string | null,
  wanted: boolean,
  query: string,
  limit: number,
) => {
  const { files, error } = useFileList(root, wanted);
  const prepared = useMemo(
    () => files?.map((rel) => ({ rel, key: pathKey(rel) })) ?? null,
    [files],
  );
  const narrowing = useRef<FileNarrowing | null>(null);
  const matches = useMemo(() => {
    if (!wanted || !prepared) return [];
    const last = narrowing.current;
    const pool = last?.files === prepared && query.startsWith(last.query) ? last.matched : prepared;
    const { top, matched } = topFiles(pool, query, limit);
    narrowing.current = { files: prepared, query, matched };
    return top;
  }, [wanted, prepared, query, limit]);
  return { matches, listed: files !== null, error };
};

const listFiles = async (root: string) => {
  const key = normalizePath(root);
  const cached = fileCache.get(key);
  const since = watchedSince(root);
  const watchedThroughout = since !== null && cached !== undefined && since <= cached.at;
  const maxAge = watchedThroughout ? FILE_CACHE_MS : UNWATCHED_FILE_CACHE_MS;
  if (cached && Date.now() - cached.at < maxAge && cached.at > (filesChangedAt.get(key) ?? 0))
    return cached.files;
  const at = Date.now();
  const files = await api.listFiles(root);
  fileCache.set(key, { at, files });
  return files;
};

const useFileList = (root: string | null, wanted: boolean) => {
  const [wantedRoot, setWantedRoot] = useState<string | null>(null);
  useEffect(() => {
    if (wanted && root) setWantedRoot(root);
  }, [wanted, root]);
  const active = wanted || wantedRoot === root ? root : null;
  const { data, error } = useAsync(active ? () => listFiles(active) : null, [active]);
  return {
    files: data ?? (active ? (fileCache.get(normalizePath(active))?.files ?? null) : null),
    error: error ? failedTo("list this folder's files", error) : null,
  };
};
