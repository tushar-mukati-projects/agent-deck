import { useEffect, useState } from "react";

import { normalizePath, samePath, toggled } from "@/lib/utils";
import { activeWorkspaceOf, useWorkspaceStore } from "@/stores/workspace-store";
import type { SessionGroup } from "@/lib/session-list";

export const useExpandedGroups = (searching: boolean, groups: SessionGroup[]) => {
  const [saved, setSaved] = useState<Map<string, boolean>>(new Map());
  const [collapsedInSearch, setCollapsedInSearch] = useState<Set<string>>(new Set());
  const activeCwd = useWorkspaceStore((s) => activeWorkspaceOf(s)?.cwd ?? null);

  useEffect(() => {
    if (!searching) setCollapsedInSearch((current) => (current.size ? new Set() : current));
  }, [searching]);

  const isExpanded = (cwd: string) => {
    const key = normalizePath(cwd);
    if (searching) return !collapsedInSearch.has(key);
    const choice = saved.get(key);
    if (choice !== undefined) return choice;
    return groups.length === 1 || (!!activeCwd && samePath(activeCwd, cwd));
  };

  const toggle = (cwd: string) => {
    const key = normalizePath(cwd);
    if (searching) {
      setCollapsedInSearch((current) => toggled(current, key));
    } else {
      setSaved((current) => new Map(current).set(key, !isExpanded(cwd)));
    }
  };

  return { isExpanded, toggle };
};
