import { BrainCircuit, Files, GitCompare, PanelRightClose } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import { Tab, TabStrip } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { ChangesPanel } from "@/features/changes/ChangesPanel";
import { AgentConfigPanel } from "@/features/agent-config/AgentConfigPanel";
import { ExplorerPanel } from "@/features/explorer/ExplorerPanel";
import { SessionsPanel } from "@/features/sidebar/SessionsPanel";
import { shortcutLabel, type ShortcutAction } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { agentName } from "@/stores/agents";
import { useUiStore } from "@/stores/ui-store";
import { activeWorkspaceOf, useWorkspaceStore } from "@/stores/workspace-store";
import type { ContextView } from "@/types";

const TABS: { view: ContextView; label: string; icon: typeof Files; shortcut: ShortcutAction }[] = [
  { view: "explorer", label: "Files", icon: Files, shortcut: "showExplorer" },
  { view: "changes", label: "Changes", icon: GitCompare, shortcut: "showChanges" },
  { view: "agent", label: "Agent", icon: BrainCircuit, shortcut: "showAgentConfig" },
];

const PANELS: Record<ContextView, { render: () => React.ReactNode; keepMounted?: boolean }> = {
  explorer: { render: () => <ExplorerPanel />, keepMounted: true },
  changes: { render: () => <ChangesPanel /> },
  agent: { render: () => <AgentConfigPanel /> },
};

export const SessionsSidebar = () => (
  <aside className="h-full min-h-0 border-r border-border bg-panel">
    <SessionsPanel />
  </aside>
);

export const ContextPanel = () => {
  const view = useUiStore((s) => s.contextView);
  const agent = useWorkspaceStore((s) => activeWorkspaceOf(s)?.agent);
  const { showContext, setContextOpen } = useUiStore.getState();

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-border bg-panel">
      <div className="flex h-9 shrink-0 items-stretch border-b border-border px-1.5">
        <TabStrip label="Session panel" className="items-stretch gap-0.5">
          {TABS.map(({ view: tab, label: fallback, icon: Icon, shortcut }) => {
            const label = tab === "agent" && agent ? agentName(agent) : fallback;
            return (
              <Tooltip key={tab} content={`${label} (${shortcutLabel(shortcut)})`}>
                <Tab
                  selected={view === tab}
                  onSelect={() => showContext(tab)}
                  tabId={`context-tab-${tab}`}
                  controls={`context-panel-${tab}`}
                  className={cn(
                    "px-2.5 text-[12px] transition-colors",
                    view === tab ? "text-fg" : "text-faint hover:text-fg",
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={1.75} />
                  {label}
                  {view === tab && (
                    <span className="absolute inset-x-1.5 bottom-0 h-[2px] rounded-full bg-accent" />
                  )}
                </Tab>
              </Tooltip>
            );
          })}
        </TabStrip>
        <div className="flex-1" />
        <div className="flex items-center">
          <IconButton
            label="Hide session panel"
            shortcut={shortcutLabel("toggleContext")}
            onClick={() => setContextOpen(false)}
          >
            <PanelRightClose />
          </IconButton>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {TABS.map(({ view: tab }) => {
          const panel = PANELS[tab];
          if (view !== tab && !panel.keepMounted) return null;
          return (
            <div
              key={tab}
              role="tabpanel"
              id={`context-panel-${tab}`}
              aria-labelledby={`context-tab-${tab}`}
              hidden={view !== tab}
              className="h-full"
            >
              {panel.render()}
            </div>
          );
        })}
      </div>
    </aside>
  );
};
