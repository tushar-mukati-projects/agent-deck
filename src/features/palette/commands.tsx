import {
  Bell,
  BrainCircuit,
  Copy,
  EyeOff,
  FolderOpen,
  FolderPlus,
  GitCompare,
  GitFork,
  Keyboard,
  MessageSquareText,
  MessagesSquare,
  Palette,
  PanelLeft,
  PanelRight,
  PencilLine,
  Play,
  RefreshCw,
  RotateCcw,
  Settings,
  SquareTerminal,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { startNewSession, resumeWorkspace, startSessionInPickedFolder } from "@/actions/sessions";
import { closeIdleWorkspaces, closeOtherWorkspaces, closeWorkspaces } from "@/actions/workspaces";
import { runShortcut } from "@/hooks/useGlobalShortcuts";
import { copyText, revealInExplorer } from "@/lib/tauri/system";
import { resumeCommandLine } from "@/lib/agents/launch";
import { THEMES } from "@/lib/themes";
import { basename } from "@/lib/utils";
import { findAgent, listAgents } from "@/stores/agents";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { ShortcutAction } from "@/lib/shortcuts";
import type { Workspace } from "@/types";

export interface CommandDef {
  id: string;
  title: string;
  icon: React.ReactNode;
  shortcut?: ShortcutAction;
  run: () => void;
}

const shortcut = (action: ShortcutAction, title: string, icon: React.ReactNode): CommandDef => ({
  id: action,
  title,
  icon,
  shortcut: action,
  run: () => runShortcut(action),
});

export const buildCommands = (workspace: Workspace | null): CommandDef[] => {
  const settings = useSettingsStore.getState();
  const commands: CommandDef[] = [
    ...(workspace
      ? listAgents().map((agent) => ({
          id: `new-here:${agent.id}`,
          title: `New ${agent.name} session in ${basename(workspace.cwd)}`,
          icon: <Sparkles />,
          shortcut: agent.id === settings.defaultAgent ? ("newSession" as const) : undefined,
          run: () => void startNewSession(workspace.cwd, agent.id),
        }))
      : [shortcut("newSession", "New session in folder…", <Sparkles />)]),
    {
      id: "new-folder",
      title: "New session in another folder…",
      icon: <FolderPlus />,
      run: () => void startSessionInPickedFolder(workspace?.cwd),
    },
    shortcut("searchChats", "Search inside conversations", <MessageSquareText />),
    shortcut("reopenTab", "Reopen closed tab", <RotateCcw />),
    shortcut("nextAttention", "Jump to session waiting for you", <Bell />),
    shortcut("showSessions", "Show sessions", <MessagesSquare />),
    shortcut("showExplorer", "Show explorer", <FolderOpen />),
    shortcut("showChanges", "Show what changed", <GitCompare />),
    shortcut(
      "showAgentConfig",
      "Show the agent's memory, MCP servers and skills",
      <BrainCircuit />,
    ),
    shortcut("toggleSessions", "Toggle sessions list", <PanelLeft />),
    shortcut(
      "toggleContext",
      "Toggle session panel (files, changes, agent config)",
      <PanelRight />,
    ),
    {
      id: "refresh",
      title: "Refresh session list",
      icon: <RefreshCw />,
      run: () => void useSessionsStore.getState().refresh(),
    },
    {
      id: "close-idle",
      title: "Close tabs with nothing running",
      icon: <X />,
      run: () => void closeIdleWorkspaces(),
    },
    shortcut("fontBigger", "Terminal: bigger font", <ZoomIn />),
    shortcut("fontSmaller", "Terminal: smaller font", <ZoomOut />),
    shortcut("shortcuts", "Keyboard shortcuts", <Keyboard />),
    shortcut("settings", "Settings", <Settings />),
    shortcut("notes", "Notes", <PencilLine />),
    shortcut("toggleHideMode", "Toggle hide mode", <EyeOff />),
    ...THEMES.map((theme) => ({
      id: `theme-${theme.id}`,
      title: `Theme: ${theme.name}`,
      icon: <Palette />,
      run: () => settings.set({ themeId: theme.id }),
    })),
  ];
  if (!workspace) return commands;
  const session = useSessionsStore.getState().byId[workspace.sessionId];
  const agent = findAgent(workspace.agent);
  return [
    ...(workspace.mode === "preview"
      ? [
          {
            id: "resume",
            title: "Resume this session",
            icon: <Play />,
            run: () => void resumeWorkspace(workspace.id),
          },
        ]
      : []),
    ...(session && agent.canFork
      ? [
          {
            id: "fork",
            title: "Fork this session",
            icon: <GitFork />,
            run: () => void resumeWorkspace(workspace.id, { fork: true }),
          },
        ]
      : []),
    shortcut("newShell", "New shell", <SquareTerminal />),
    shortcut("toggleShell", "Toggle shell panel", <SquareTerminal />),
    {
      id: "reveal",
      title: "Reveal folder in File Explorer",
      icon: <FolderOpen />,
      run: () => void revealInExplorer(workspace.cwd),
    },
    {
      id: "copy-id",
      title: "Copy session ID",
      icon: <Copy />,
      run: () => void copyText(workspace.sessionId),
    },
    ...(session && agent.history
      ? [
          {
            id: "copy-resume",
            title: "Copy resume command",
            icon: <Copy />,
            run: () => void copyText(resumeCommandLine(session, useSettingsStore.getState())),
          },
        ]
      : []),
    {
      id: "close",
      title: "Close this tab",
      icon: <X />,
      run: () => void closeWorkspaces([workspace.id]),
    },
    {
      id: "close-others",
      title: "Close other tabs",
      icon: <X />,
      run: () => void closeOtherWorkspaces(workspace.id),
    },
    ...commands,
  ];
};
