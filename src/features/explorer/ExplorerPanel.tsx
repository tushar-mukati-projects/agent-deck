import { useEffect } from "react";
import {
  ChevronsDownUp,
  Eye,
  EyeOff,
  FolderOpen,
  FolderTree,
  RefreshCw,
  Search,
} from "lucide-react";

import { EmptyState, Spinner } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { FileTree } from "@/features/explorer/FileTree";
import { shortcutLabel } from "@/lib/shortcuts";
import { revealInExplorer } from "@/lib/tauri/system";
import { basename, normalizePath } from "@/lib/utils";
import { useExplorerStore } from "@/stores/explorer-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import { useActiveWorkspace } from "@/stores/workspace-store";

export const ExplorerPanel = () => {
  const workspace = useActiveWorkspace();
  const root = workspace?.cwd ?? null;
  const rootKey = root ? normalizePath(root) : "";
  const loaded = useExplorerStore((s) => !!s.children[rootKey]);
  const error = useExplorerStore((s) => s.errors[rootKey]);
  const showHidden = useSettingsStore((s) => s.showHidden);
  const setSettings = useSettingsStore((s) => s.set);
  const openPalette = useUiStore((s) => s.openPalette);

  useEffect(() => {
    if (!root) return;
    const { children, load } = useExplorerStore.getState();
    if (!children[normalizePath(root)]) void load(root);
  }, [root]);

  if (!workspace || !root) {
    return (
      <EmptyState
        className="h-full"
        icon={<FolderTree />}
        title="No folder open"
        description="Open a session from the Sessions view and its folder will appear here."
      />
    );
  }

  const refreshAll = () => {
    const { children, load } = useExplorerStore.getState();
    for (const dir of Object.keys(children)) void load(dir);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between pr-2 pl-3.5">
        <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">
          Explorer
        </span>
        <div className="flex items-center gap-0.5">
          <IconButton
            label="Find file"
            shortcut={shortcutLabel("quickOpen")}
            onClick={() => openPalette("files")}
          >
            <Search />
          </IconButton>
          <IconButton
            label={showHidden ? "Hide hidden files" : "Show hidden files"}
            onClick={() => setSettings({ showHidden: !showHidden })}
          >
            {showHidden ? <Eye /> : <EyeOff />}
          </IconButton>
          <IconButton label="Refresh" onClick={refreshAll}>
            <RefreshCw />
          </IconButton>
          <IconButton
            label="Collapse all"
            onClick={() => useExplorerStore.getState().collapseAll(root)}
          >
            <ChevronsDownUp />
          </IconButton>
        </div>
      </div>
      <button
        type="button"
        title={root}
        onClick={() => void revealInExplorer(root)}
        className="mx-2 mb-1 flex h-7 items-center gap-2 rounded-md px-1.5 text-left text-xs font-semibold text-fg hover:bg-hover"
      >
        <FolderOpen className="size-3.5 shrink-0 text-folder" />
        <span className="truncate">{basename(root)}</span>
      </button>
      {error ? (
        <EmptyState icon={<FolderTree />} title="Can't open this folder" description={error} />
      ) : !loaded ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <FileTree workspace={workspace} />
      )}
    </div>
  );
};
