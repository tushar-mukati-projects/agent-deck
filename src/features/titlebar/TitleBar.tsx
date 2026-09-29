import { useEffect, useState } from "react";
import {
  Copy,
  Keyboard,
  Minus,
  PanelLeft,
  PanelRight,
  Plus,
  Search,
  Settings,
  Square,
  X,
} from "lucide-react";

import { useShallow } from "zustand/react/shallow";

import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { TabStrip } from "@/components/ui/tabs";
import { NewSessionMenu } from "@/features/titlebar/NewSessionMenu";
import { WorkspaceTab } from "@/features/titlebar/WorkspaceTab";
import { shortcutLabel } from "@/lib/shortcuts";
import { appWindow } from "@/lib/tauri/system";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const WindowControls = () => {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let timer: number | undefined;
    const sync = () => void appWindow.isMaximized().then(setMaximized);
    sync();
    const unlisten = appWindow.onResized(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(sync, 120);
    });
    return () => {
      window.clearTimeout(timer);
      void unlisten.then((fn) => fn());
    };
  }, []);

  const controlClass =
    "flex h-full w-[46px] items-center justify-center text-muted transition-colors duration-75 hover:bg-hover hover:text-fg";

  return (
    <div className="flex h-full">
      <button
        type="button"
        aria-label="Minimize"
        className={controlClass}
        onClick={() => appWindow.minimize()}
      >
        <Minus className="size-4" strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label={maximized ? "Restore" : "Maximize"}
        className={controlClass}
        onClick={() => appWindow.toggleMaximize()}
      >
        {maximized ? (
          <Copy className="size-3 -scale-x-100" strokeWidth={1.5} />
        ) : (
          <Square className="size-3" strokeWidth={1.5} />
        )}
      </button>
      <button
        type="button"
        aria-label="Close"
        className={`${controlClass} hover:!bg-[#c42b1c] hover:!text-white`}
        onClick={() => appWindow.close()}
      >
        <X className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  );
};

export const TitleBar = () => {
  const workspaceIds = useWorkspaceStore(useShallow((s) => s.workspaces.map((w) => w.id)));
  const openPalette = useUiStore((s) => s.openPalette);
  const sessionsOpen = useUiStore((s) => s.sessionsOpen);
  const contextOpen = useUiStore((s) => s.contextOpen);
  const hasWorkspace = useWorkspaceStore((s) => s.workspaces.some((w) => w.id === s.activeId));
  const { toggleSessions, toggleContext, setShortcutsOpen, setSettingsOpen } =
    useUiStore.getState();

  return (
    <header className="relative flex h-[38px] shrink-0 items-stretch border-b border-border bg-panel">
      <div data-tauri-drag-region className="flex shrink-0 items-center gap-1 pr-1 pl-3">
        <img src="/app-icon.svg" alt="" className="pointer-events-none size-[18px]" />
        <IconButton
          label={sessionsOpen ? "Hide sessions list" : "Show sessions list"}
          shortcut={shortcutLabel("toggleSessions")}
          active={sessionsOpen}
          onClick={toggleSessions}
        >
          <PanelLeft />
        </IconButton>
      </div>

      <div className="flex min-w-0 flex-1 items-stretch">
        <TabStrip label="Session tabs" className="min-w-0 items-stretch">
          {workspaceIds.map((id) => (
            <WorkspaceTab key={id} workspaceId={id} />
          ))}
        </TabStrip>
        <div data-tauri-drag-region className="flex min-w-10 flex-1 items-center pl-1">
          <NewSessionMenu>
            <IconButton label="New session" shortcut={shortcutLabel("newSession")}>
              <Plus />
            </IconButton>
          </NewSessionMenu>
        </div>
      </div>

      <div data-tauri-drag-region className="flex min-w-0 shrink items-center px-2">
        <button
          type="button"
          onClick={() => openPalette("all")}
          className="flex h-[26px] w-[300px] max-w-[30vw] min-w-[120px] items-center gap-2 rounded-md border border-border bg-bg/60 px-2.5 text-xs text-faint transition-colors hover:border-border-strong hover:text-muted"
        >
          <Search className="size-3.5" />
          <span className="flex-1 truncate text-left whitespace-nowrap">
            Search sessions, files, actions
          </span>
          <Kbd keys={shortcutLabel("palette")} />
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 pr-2">
        {hasWorkspace && (
          <IconButton
            label={
              contextOpen
                ? "Hide session panel"
                : "Show files, changes and agent config for this session"
            }
            shortcut={shortcutLabel("toggleContext")}
            active={contextOpen}
            onClick={toggleContext}
          >
            <PanelRight />
          </IconButton>
        )}
        <IconButton
          label="Keyboard shortcuts"
          shortcut={shortcutLabel("shortcuts")}
          onClick={() => setShortcutsOpen(true)}
        >
          <Keyboard />
        </IconButton>
        <IconButton
          label="Settings"
          shortcut={shortcutLabel("settings")}
          onClick={() => setSettingsOpen(true)}
        >
          <Settings />
        </IconButton>
      </div>

      <WindowControls />
    </header>
  );
};
