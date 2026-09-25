import { useEffect, useState } from "react";
import { Group, Panel, usePanelRef, type PanelSize } from "react-resizable-panels";
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
import { useUiStore, type SidePanel } from "@/stores/ui-store";
import { useActiveWorkspace } from "@/stores/workspace-store";

const FLAG = { sessions: "sessionsOpen", context: "contextOpen" } as const;
const WIDTH = { sessions: "sessionsWidth", context: "contextWidth" } as const;

let draggingSeparator = false;
window.addEventListener(
  "pointerdown",
  (event) => {
    draggingSeparator = !!(event.target as Element | null)?.closest?.("[data-separator]");
  },
  true,
);
window.addEventListener("pointerup", () => (draggingSeparator = false), true);

const useSidePanel = (panel: SidePanel, available = true) => {
  const panelRef = usePanelRef();
  const open = useUiStore((s) => s[FLAG[panel]]) && available;
  const [initialWidth] = useState(() => useUiStore.getState()[WIDTH[panel]]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const handle = panelRef.current;
      if (!handle) return;
      if (open && handle.isCollapsed()) handle.resize(useUiStore.getState()[WIDTH[panel]]);
      if (!open && !handle.isCollapsed()) handle.collapse();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, panel, panelRef]);

  const onResize = (size: PanelSize) => {
    if (!available || !draggingSeparator) return;
    const collapsed = size.inPixels < 1;
    const state = useUiStore.getState();
    if (collapsed === state[FLAG[panel]]) useUiStore.setState({ [FLAG[panel]]: !collapsed });
    if (!collapsed) state.setPanelWidth(panel, Math.round(size.inPixels));
  };

  return { panelRef, onResize, initialWidth };
};

export const App = () => {
  const workspace = useActiveWorkspace();
  const themeKind = useSettingsStore((s) => findTheme(s.themeId).kind);
  const sessions = useSidePanel("sessions");
  const context = useSidePanel("context", !!workspace);
  useAppEvents();
  useGlobalShortcuts();
  useAttentionAlerts();

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <TitleBar />
        <Group orientation="horizontal" className="min-h-0 flex-1">
          <Panel
            id="sessions"
            panelRef={sessions.panelRef}
            defaultSize={sessions.initialWidth}
            minSize={220}
            maxSize={520}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            onResize={sessions.onResize}
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
            defaultSize={context.initialWidth}
            minSize={240}
            maxSize={640}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            onResize={context.onResize}
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
