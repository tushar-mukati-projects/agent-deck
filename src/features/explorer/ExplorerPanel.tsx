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

import { EmptyState, LoadingState } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { PanelHeader } from "@/components/ui/panel-header";
import { FileTree } from "@/features/explorer/FileTree";
import { decodeMcpTab, tabTargetPath } from "@/lib/diff-tabs";
import { shortcutLabel } from "@/lib/shortcuts";
import { revealInExplorer } from "@/lib/tauri/system";
import { basename, isWithin, normalizePath } from "@/lib/utils";
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

  useEffect(() => {
    if (!root) return;
    const { children, load } = useExplorerStore.getState();
    if (!children[normalizePath(root)]) void load(root);
  }, [root]);

  const revealTarget =
    workspace?.activeFile && decodeMcpTab(workspace.activeFile) === null
      ? tabTargetPath(workspace.activeFile)
      : null;

  useEffect(() => {
    if (root && revealTarget && isWithin(revealTarget, root))
      void useExplorerStore.getState().reveal(revealTarget, root);
  }, [root, revealTarget]);

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={basename(root)}>
        <IconButton
          label="Find file or folder"
          shortcut={shortcutLabel("quickOpen")}
          onClick={() => useUiStore.getState().openPalette("files")}
        >
          <Search />
        </IconButton>
        <IconButton
          label={showHidden ? "Hide hidden files" : "Show hidden files"}
          onClick={() => useSettingsStore.getState().set({ showHidden: !showHidden })}
        >
          {showHidden ? <Eye /> : <EyeOff />}
        </IconButton>
        <IconButton label="Refresh" onClick={() => useExplorerStore.getState().refresh(root)}>
          <RefreshCw />
        </IconButton>
        <IconButton
          label="Collapse all"
          onClick={() => useExplorerStore.getState().collapseAll(root)}
        >
          <ChevronsDownUp />
        </IconButton>
        <IconButton
          label="Reveal folder in File Explorer"
          onClick={() => void revealInExplorer(root)}
        >
          <FolderOpen />
        </IconButton>
      </PanelHeader>
      {error && !loaded ? (
        <EmptyState icon={<FolderTree />} title="Can't open this folder" description={error} />
      ) : !loaded ? (
        <LoadingState className="py-8" />
      ) : (
        <FileTree workspace={workspace} />
      )}
    </div>
  );
};
