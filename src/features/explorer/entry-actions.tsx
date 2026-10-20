import { FilePlus, FolderPlus, Pencil, Trash2 } from "lucide-react";

import { askNewEntry, askRename, deleteEntry } from "@/actions/entries";
import type { DirEntry, Workspace } from "@/types";

export const entryActions = (entry: DirEntry, workspace: Workspace) => {
  const rename = { label: "Rename…", icon: <Pencil />, run: () => askRename(workspace, entry) };
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
