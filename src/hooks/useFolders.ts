import { useMemo } from "react";

import { basename, normalizePath } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";

export interface FolderSummary {
  cwd: string;
  name: string;
  count: number;
  lastModifiedMs: number;
}

export const useFolders = () => {
  const sessions = useSessionsStore((s) => s.sessions);
  return useMemo(() => {
    const folders = new Map<string, FolderSummary>();
    for (const session of sessions) {
      const key = normalizePath(session.cwd);
      const existing = folders.get(key);
      if (existing) {
        existing.count += 1;
        existing.lastModifiedMs = Math.max(existing.lastModifiedMs, session.modifiedMs);
      } else {
        folders.set(key, {
          cwd: session.cwd,
          name: basename(session.cwd),
          count: 1,
          lastModifiedMs: session.modifiedMs,
        });
      }
    }
    return [...folders.values()].sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
  }, [sessions]);
};
