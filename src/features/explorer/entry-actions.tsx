import { FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";

import { askNewEntry, deleteEntry } from "@/actions/entries";
import { useUiStore } from "@/stores/ui-store";
import type { DirEntry, Workspace } from "@/types";

export const entryActions = (entry: DirEntry, workspace: Workspace) => {
  const rename = {
    label: "Rename…",
    icon: <Pencil />,
    run: () =>
      useUiStore
        .getState()
        .setEntryRequest({ kind: "rename", path: entry.path, isDir: entry.isDir }),
  };
  const remove = { label: "Delete…", icon: <Trash2 />, run: () => void deleteEntry(entry) };
  if (!entry.isDir) return [rename, remove];
  return [
    {
      label: "New file…",
      icon: <FilePlus />,
      run: () => askNewEntry(workspace, entry.path, false),
    },
    {
      label: "New folder…",
      icon: <FolderPlus />,
      run: () => askNewEntry(workspace, entry.path, true),
    },
    rename,
    remove,
  ];
};
