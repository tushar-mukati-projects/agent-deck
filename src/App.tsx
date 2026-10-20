import { Group, Panel } from "react-resizable-panels";
import { Toaster } from "sonner";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NotesDialog } from "@/features/notes/NotesDialog";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { ConfirmDialog } from "@/features/settings/ConfirmDialog";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { ShortcutsDialog } from "@/features/shortcuts/ShortcutsDialog";
import { RenameDialog } from "@/features/sidebar/RenameDialog";
import { SessionsPanel } from "@/features/sidebar/SessionsPanel";
import { ContextPanel } from "@/features/sidebar/Sidebar";
import { StatusBar } from "@/features/statusbar/StatusBar";
import { TitleBar } from "@/features/titlebar/TitleBar";
import { Welcome } from "@/features/welcome/Welcome";
import { ResizeHandle, WorkspaceView } from "@/features/workspace/WorkspaceView";
import { useAgentThemeSync } from "@/hooks/useAgentThemeSync";
import { useAppEvents } from "@/hooks/useAppEvents";
import { useAttentionAlerts } from "@/hooks/useAttentionAlerts";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useSidePanel } from "@/hooks/useSidePanel";
import { useWindowActivity } from "@/hooks/useWindowActivity";
import { DESKTOP_AGENT_OPT_IN_ID } from "@/lib/desktopAgent";
import { findTheme } from "@/lib/themes";
import { useSettingsStore } from "@/stores/settings-store";
import { activeWorkspaceOf, useWorkspaceStore } from "@/stores/workspace-store";

const SESSIONS_MIN_PX = 220;
const SESSIONS_MAX_PX = 520;
const CONTENT_MIN_PX = 420;
const CONTEXT_MIN_PX = 240;
const CONTEXT_MAX_PX = 640;
const TOAST_OFFSET_PX = 36;

export const App = () => {
  const activeId = useWorkspaceStore((s) => activeWorkspaceOf(s)?.id ?? null);
  const themeKind = useSettingsStore((s) => findTheme(s.themeId).kind);
  const sessions = useSidePanel("sessions");
  const context = useSidePanel("context", !!activeId);
  useAppEvents();
  useGlobalShortcuts();
  useAttentionAlerts();
  useWindowActivity();
  useAgentThemeSync();

  return (
    <TooltipProvider>
      <div
        id={DESKTOP_AGENT_OPT_IN_ID}
        role="group"
        aria-label="Agent Deck"
        className="flex h-full flex-col"
      >
        <TitleBar />
        <Group orientation="horizontal" className="min-h-0 flex-1">
          <Panel
            id="sessions"
            panelRef={sessions.panelRef}
            defaultSize={sessions.initialWidth}
            minSize={SESSIONS_MIN_PX}
            maxSize={SESSIONS_MAX_PX}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            onResize={sessions.onResize}
          >
            <ErrorBoundary>
              <aside className="h-full min-h-0 border-r border-border bg-panel">
                <SessionsPanel />
              </aside>
            </ErrorBoundary>
          </Panel>
          <ResizeHandle orientation="horizontal" />
          <Panel id="content" minSize={CONTENT_MIN_PX}>
            <ErrorBoundary key={activeId ?? "welcome"}>
              {activeId ? <WorkspaceView workspaceId={activeId} /> : <Welcome />}
            </ErrorBoundary>
          </Panel>
          <ResizeHandle orientation="horizontal" />
          <Panel
            id="context"
            panelRef={context.panelRef}
            defaultSize={context.initialWidth}
            minSize={CONTEXT_MIN_PX}
            maxSize={CONTEXT_MAX_PX}
            collapsible
            groupResizeBehavior="preserve-pixel-size"
            onResize={context.onResize}
          >
            <ErrorBoundary key={activeId ?? "none"}>{activeId && <ContextPanel />}</ErrorBoundary>
          </Panel>
        </Group>
        <StatusBar />
      </div>
      <CommandPalette />
      <SettingsDialog />
      <ConfirmDialog />
      <RenameDialog />
      <ShortcutsDialog />
      <NotesDialog />
      <Toaster
        theme={themeKind}
        position="bottom-right"
        offset={TOAST_OFFSET_PX}
        toastOptions={{
          className: "!bg-overlay !border-border-strong !text-fg !text-[12.5px] !shadow-2xl",
        }}
      />
    </TooltipProvider>
  );
};
