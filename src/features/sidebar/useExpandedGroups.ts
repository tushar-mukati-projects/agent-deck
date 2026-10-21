import { useState } from "react";

import { normalizePath, samePath } from "@/lib/utils";
import { activeWorkspaceOf, useWorkspaceStore } from "@/stores/workspace-store";
import type { SessionGroup } from "@/lib/session-list";

export const useExpandedGroups = (searching: boolean, groups: SessionGroup[]) => {
  const [saved, setSaved] = useState<Map<string, boolean>>(new Map());
  const activeCwd = useWorkspaceStore((s) => activeWorkspaceOf(s)?.cwd ?? null);

  const isExpanded = (cwd: string) => {
    if (searching) return true;
    const choice = saved.get(normalizePath(cwd));
    if (choice !== undefined) return choice;
    return groups.length === 1 || (!!activeCwd && samePath(activeCwd, cwd));
  };

  const toggle = (cwd: string) =>
    setSaved((current) => new Map(current).set(normalizePath(cwd), !isExpanded(cwd)));

  return { isExpanded, toggle };
};
