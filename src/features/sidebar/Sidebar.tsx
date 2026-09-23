import { Files, GitCompare, MessagesSquare, Settings } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import { ChangesPanel } from "@/features/changes/ChangesPanel";
import { ExplorerPanel } from "@/features/explorer/ExplorerPanel";
import { SessionsPanel } from "@/features/sidebar/SessionsPanel";
import { shortcutLabel } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import type { SidebarView } from "@/types";

const VIEWS: { view: SidebarView; label: string; icon: typeof Files; shortcut: string }[] = [
  { view: "sessions", label: "Sessions", icon: MessagesSquare, shortcut: shortcutLabel("showSessions") },
  { view: "explorer", label: "Explorer", icon: Files, shortcut: shortcutLabel("showExplorer") },
  { view: "changes", label: "What changed", icon: GitCompare, shortcut: shortcutLabel("showChanges") },
];

export const ActivityBar = () => {
  const sidebarView = useUiStore((s) => s.sidebarView);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const { setSidebarView, toggleSidebar, setSettingsOpen } = useUiStore.getState();

  const select = (view: SidebarView) => {
    if (view === sidebarView && sidebarOpen) toggleSidebar();
    else setSidebarView(view);
  };

  return (
    <nav className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border bg-panel py-2">
      {VIEWS.map(({ view, label, icon: Icon, shortcut }) => {
        const active = sidebarOpen && sidebarView === view;
        return (
          <div key={view} className="relative">
            {active && <span className="absolute top-1.5 bottom-1.5 -left-[6px] w-[2px] rounded-full bg-accent" />}
            <IconButton
              size="md"
              label={label}
              shortcut={shortcut}
              tooltipSide="right"
              onClick={() => select(view)}
              className={cn(active ? "text-fg" : "text-faint")}
            >
              <Icon strokeWidth={1.75} />
            </IconButton>
          </div>
        );
      })}
      <div className="flex-1" />
      <IconButton
        size="md"
        label="Settings"
        shortcut={shortcutLabel("settings")}
        tooltipSide="right"
        onClick={() => setSettingsOpen(true)}
      >
        <Settings strokeWidth={1.75} />
      </IconButton>
    </nav>
  );
};

export const SidePanel = () => {
  const sidebarView = useUiStore((s) => s.sidebarView);
  return (
    <aside className="h-full min-h-0 border-r border-border bg-panel">
      <div className={cn("h-full", sidebarView !== "sessions" && "hidden")}>
        <SessionsPanel />
      </div>
      <div className={cn("h-full", sidebarView !== "explorer" && "hidden")}>
        <ExplorerPanel />
      </div>
      {sidebarView === "changes" && <ChangesPanel />}
    </aside>
  );
};
