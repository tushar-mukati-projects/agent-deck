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
import { ContextPanel, SessionsSidebar } from "@/features/sidebar/Sidebar";
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

type PanelFlag = "sessionsOpen" | "contextOpen";

const useCollapsible = (flag: PanelFlag, available = true) => {
  const panelRef = usePanelRef();
  const open = useUiStore((s) => s[flag]) && available;

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      if (open && panel.isCollapsed()) panel.expand();
      if (!open && !panel.isCollapsed()) panel.collapse();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, panelRef]);

  const syncFromDrag = () => {
    const panel = panelRef.current;
    if (!panel || !available) return;
    const collapsed = panel.isCollapsed();
    if (collapsed === useUiStore.getState()[flag]) useUiStore.setState({ [flag]: !collapsed });
  };

  return { panelRef, syncFromDrag };
};

export const App = () => {
  const workspace = useActiveWorkspace();
  const themeKind = useSettingsStore((s) => findTheme(s.themeId).kind);
  const sessions = useCollapsible("sessionsOpen");
  const context = useCollapsible("contextOpen", !!workspace);
  const layout = useDefaultLayout({
    id: "deck-shell-v2",
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
        <Group
          orientation="horizontal"
          className="min-h-0 flex-1"
          defaultLayout={layout.defaultLayout}
          onLayoutChanged={layout.onLayoutChanged}
        >
          <Panel
            id="sessions"
            panelRef={sessions.panelRef}
            defaultSize={280}
            minSize={220}
            maxSize={520}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            onResize={sessions.syncFromDrag}
          >
            <ErrorBoundary>
              <SessionsSidebar />
            </ErrorBoundary>
          </Panel>
          <ResizeHandle orientation="horizontal" />
          <Panel id="content" minSize={420}>
            <ErrorBoundary key={workspace?.id ?? "welcome"}>
              {workspace ? <WorkspaceView key={workspace.id} workspace={workspace} /> : <Welcome />}
            </ErrorBoundary>
          </Panel>
          <ResizeHandle orientation="horizontal" />
          <Panel
            id="context"
            panelRef={context.panelRef}
            defaultSize={320}
            minSize={240}
            maxSize={640}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            onResize={context.syncFromDrag}
          >
            <ErrorBoundary>{workspace && <ContextPanel />}</ErrorBoundary>
          </Panel>
        </Group>
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
