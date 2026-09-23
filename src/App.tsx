import { useEffect } from "react";
import { Group, Panel, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { Toaster } from "sonner";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { ConfirmDialog } from "@/features/settings/ConfirmDialog";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { ShortcutsDialog } from "@/features/shortcuts/ShortcutsDialog";
import { RenameDialog } from "@/features/sidebar/RenameDialog";
import { ActivityBar, SidePanel } from "@/features/sidebar/Sidebar";
import { StatusBar } from "@/features/statusbar/StatusBar";
import { TitleBar } from "@/features/titlebar/TitleBar";
import { Welcome } from "@/features/welcome/Welcome";
import { ResizeHandle, WorkspaceView } from "@/features/workspace/WorkspaceView";
import { useAppEvents } from "@/hooks/useAppEvents";
import { useAttentionAlerts } from "@/hooks/useAttentionAlerts";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { findTheme } from "@/lib/themes";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";
import { useActiveWorkspace } from "@/stores/workspace-store";

const useSidebarPanel = () => {
  const panelRef = usePanelRef();
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (sidebarOpen && panel.isCollapsed()) panel.expand();
    if (!sidebarOpen && !panel.isCollapsed()) panel.collapse();
  }, [sidebarOpen, panelRef]);

  const syncFromDrag = () => {
    const collapsed = panelRef.current?.isCollapsed() ?? false;
    if (collapsed === useUiStore.getState().sidebarOpen)
      useUiStore.setState({ sidebarOpen: !collapsed });
  };

  return { panelRef, syncFromDrag };
};

export const App = () => {
  const workspace = useActiveWorkspace();
  const themeKind = useSettingsStore((s) => findTheme(s.themeId).kind);
  const { panelRef, syncFromDrag } = useSidebarPanel();
  const layout = useDefaultLayout({
    id: "deck-shell",
    storage: localStorage,
    onlySaveAfterUserInteractions: true,
  });
  useAppEvents();
  useGlobalShortcuts();
  useAttentionAlerts();

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <ActivityBar />
          <Group
            orientation="horizontal"
            className="min-w-0 flex-1"
            defaultLayout={layout.defaultLayout}
            onLayoutChanged={layout.onLayoutChanged}
          >
            <Panel
              id="sidebar"
              panelRef={panelRef}
              defaultSize={300}
              minSize={220}
              maxSize={560}
              collapsible
              groupResizeBehavior="preserve-pixel-size"
              onResize={syncFromDrag}
            >
              <ErrorBoundary>
                <SidePanel />
              </ErrorBoundary>
            </Panel>
            <ResizeHandle orientation="horizontal" />
            <Panel id="content" minSize={420}>
              <ErrorBoundary key={workspace?.id ?? "welcome"}>
                {workspace ? (
                  <WorkspaceView key={workspace.id} workspace={workspace} />
                ) : (
                  <Welcome />
                )}
              </ErrorBoundary>
            </Panel>
          </Group>
        </div>
        <StatusBar />
      </div>
      <CommandPalette />
      <SettingsDialog />
      <ConfirmDialog />
      <RenameDialog />
      <ShortcutsDialog />
      <Toaster
        theme={themeKind}
        position="bottom-right"
        offset={36}
        toastOptions={{
          className: "!bg-overlay !border-border-strong !text-fg !text-[12.5px] !shadow-2xl",
        }}
      />
    </TooltipProvider>
  );
};
