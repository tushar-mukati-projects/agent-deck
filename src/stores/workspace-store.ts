import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  claudeSpec,
  defaultShellProgram,
  planLaunch,
  shellSpec,
  type LaunchOptions,
} from "@/lib/claude/launch";
import {
  disposeTerminal,
  hasTerminal,
  isPtyRunning,
  requestFocus,
  restartTerminal,
  startTerminal,
} from "@/lib/terminal/registry";
import { newId, samePath } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";
import { blankWorkspace, workspaceFromSession } from "@/stores/workspace-factory";
import type { SessionInfo, ShellTab, Workspace } from "@/types";

export interface ShellOptions {
  cwd?: string;
  label?: string;
  command?: string;
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string | null;
  recentlyClosed: string[];
  openSession: (session: SessionInfo) => string;
  launch: (workspaceId: string, options?: LaunchOptions) => string | null;
  newSession: (cwd: string, options?: LaunchOptions) => string;
  restartClaude: (workspaceId: string) => void;
  close: (workspaceId: string) => Promise<void>;
  activate: (workspaceId: string) => void;
  cycle: (direction: 1 | -1) => void;
  reorder: (fromId: string, toId: string) => void;
  openShell: (workspaceId: string, options?: ShellOptions) => void;
  closeShell: (workspaceId: string, shellId: string) => void;
  setActiveShell: (workspaceId: string, shellId: string) => void;
  setShellPanel: (workspaceId: string, open: boolean) => void;
  openFile: (workspaceId: string, path: string) => void;
  closeFile: (workspaceId: string, path: string) => void;
  setActiveFile: (workspaceId: string, path: string) => void;
  syncTitles: (byId: Record<string, SessionInfo>) => void;
  restore: () => void;
}

const RECENTLY_CLOSED_LIMIT = 20;

const withClaude = (workspace: Workspace, args: string[]) => {
  const next = { ...workspace, mode: "live" as const, claudeTerminalId: newId(), claudeArgs: args };
  startTerminal(claudeSpec(next), { focus: true });
  return next;
};

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => {
      const find = (id: string) => get().workspaces.find((w) => w.id === id);

      const patch = (id: string, update: (w: Workspace) => Partial<Workspace>) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...update(w) } : w)),
        }));

      const add = (workspace: Workspace) => {
        set((s) => ({ workspaces: [...s.workspaces, workspace], activeId: workspace.id }));
        return workspace.id;
      };

      return {
        workspaces: [],
        activeId: null,
        recentlyClosed: [],

        openSession: (session) => {
          const existing = get().workspaces.find((w) => w.sessionId === session.id);
          if (existing) {
            get().activate(existing.id);
            return existing.id;
          }
          return add(workspaceFromSession(session));
        },

        launch: (workspaceId, options = {}) => {
          const workspace = find(workspaceId);
          if (!workspace) return null;
          if (workspace.mode === "live" && !options.fork) {
            set({ activeId: workspaceId });
            return workspaceId;
          }
          const plan = planLaunch(workspace, options);
          if (options.fork) {
            const base = blankWorkspace({
              id: newId(),
              sessionId: plan.sessionId,
              cwd: workspace.cwd,
              title: `${workspace.title} (fork)`,
              filePath: null,
            });
            return add(withClaude(base, plan.args));
          }
          const next = withClaude(workspace, plan.args);
          set((s) => ({
            workspaces: s.workspaces.map((w) => (w.id === workspaceId ? next : w)),
            activeId: workspaceId,
          }));
          return workspaceId;
        },

        newSession: (cwd, options = {}) => {
          const sessionId = newId();
          const base = blankWorkspace({
            id: sessionId,
            sessionId,
            cwd,
            title: options.agent ? `New ${options.agent} session` : "New session",
            filePath: null,
          });
          return add(withClaude(base, planLaunch(base, options).args));
        },

        restartClaude: (workspaceId) => {
          const workspace = find(workspaceId);
          if (!workspace?.claudeTerminalId) return;
          const next = {
            ...workspace,
            claudeTerminalId: workspace.claudeTerminalId,
            claudeArgs: planLaunch(workspace).args,
          };
          patch(workspaceId, () => ({ claudeArgs: next.claudeArgs }));
          void restartTerminal(next.claudeTerminalId, claudeSpec(next));
        },

        close: async (workspaceId) => {
          const { workspaces, activeId } = get();
          const index = workspaces.findIndex((w) => w.id === workspaceId);
          const workspace = workspaces[index];
          if (!workspace) return;
          const remaining = workspaces.filter((w) => w.id !== workspaceId);
          const neighbor = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
          set((s) => ({
            workspaces: remaining,
            activeId: activeId === workspaceId ? neighbor : activeId,
            recentlyClosed: [
              workspace.sessionId,
              ...s.recentlyClosed.filter((id) => id !== workspace.sessionId),
            ].slice(0, RECENTLY_CLOSED_LIMIT),
          }));
          const terminalIds = [workspace.claudeTerminalId, ...workspace.shells.map((s) => s.id)];
          await Promise.all(terminalIds.filter((id): id is string => !!id).map(disposeTerminal));
        },

        activate: (workspaceId) => {
          set({ activeId: workspaceId });
          const workspace = find(workspaceId);
          if (workspace?.mode === "live" && workspace.claudeTerminalId)
            requestFocus(workspace.claudeTerminalId);
        },

        cycle: (direction) => {
          const { workspaces, activeId } = get();
          if (workspaces.length < 2) return;
          const index = workspaces.findIndex((w) => w.id === activeId);
          get().activate(
            workspaces[(index + direction + workspaces.length) % workspaces.length].id,
          );
        },

        reorder: (fromId, toId) =>
          set((s) => {
            const list = [...s.workspaces];
            const from = list.findIndex((w) => w.id === fromId);
            const to = list.findIndex((w) => w.id === toId);
            if (from < 0 || to < 0 || from === to) return s;
            const [moved] = list.splice(from, 1);
            list.splice(to, 0, moved);
            return { workspaces: list };
          }),

        openShell: (workspaceId, options = {}) => {
          const workspace = find(workspaceId);
          if (!workspace) return;
          const cwd = options.cwd ?? workspace.cwd;
          const shell: ShellTab = {
            id: newId(),
            cwd,
            program: parseWslPath(cwd) ? "wsl.exe" : defaultShellProgram(),
            label: options.label,
            command: options.command,
          };
          startTerminal(shellSpec(workspaceId, shell), { focus: true });
          patch(workspaceId, (w) => ({
            shells: [...w.shells, shell],
            activeShellId: shell.id,
            shellPanelOpen: true,
          }));
        },

        closeShell: (workspaceId, shellId) => {
          void disposeTerminal(shellId);
          patch(workspaceId, (w) => {
            const shells = w.shells.filter((s) => s.id !== shellId);
            return {
              shells,
              activeShellId:
                w.activeShellId === shellId ? (shells.at(-1)?.id ?? null) : w.activeShellId,
              shellPanelOpen: shells.length > 0 && w.shellPanelOpen,
            };
          });
        },

        setActiveShell: (workspaceId, shellId) => {
          requestFocus(shellId);
          patch(workspaceId, () => ({ activeShellId: shellId }));
        },

        setShellPanel: (workspaceId, open) => {
          const workspace = find(workspaceId);
          if (!workspace) return;
          if (open && workspace.shells.length === 0) {
            get().openShell(workspaceId);
            return;
          }
          if (open && workspace.activeShellId) requestFocus(workspace.activeShellId);
          if (!open && workspace.claudeTerminalId) requestFocus(workspace.claudeTerminalId);
          patch(workspaceId, () => ({ shellPanelOpen: open }));
        },

        openFile: (workspaceId, path) =>
          patch(workspaceId, (w) => ({
            openFiles: w.openFiles.some((f) => samePath(f, path))
              ? w.openFiles
              : [...w.openFiles, path],
            activeFile: path,
          })),

        closeFile: (workspaceId, path) =>
          patch(workspaceId, (w) => {
            const index = w.openFiles.findIndex((f) => samePath(f, path));
            const openFiles = w.openFiles.filter((f) => !samePath(f, path));
            const wasActive = !!w.activeFile && samePath(w.activeFile, path);
            return {
              openFiles,
              activeFile: wasActive
                ? (openFiles[Math.min(index, openFiles.length - 1)] ?? null)
                : w.activeFile,
            };
          }),

        setActiveFile: (workspaceId, path) => patch(workspaceId, () => ({ activeFile: path })),

        syncTitles: (byId) =>
          set((s) => {
            let changed = false;
            const workspaces = s.workspaces.map((w) => {
              const session = byId[w.sessionId];
              if (!session) return w;
              const title = session.title ?? w.title;
              if (title === w.title && session.filePath === w.filePath) return w;
              changed = true;
              return { ...w, title, filePath: session.filePath };
            });
            return changed ? { workspaces } : s;
          }),

        restore: () =>
          set((s) => ({
            workspaces: s.workspaces.map((workspace) => {
              const shells = workspace.shells.filter((shell) => isPtyRunning(shell.id));
              shells.forEach(
                (shell) =>
                  hasTerminal(shell.id) ||
                  startTerminal(shellSpec(workspace.id, { ...shell, command: undefined })),
              );
              const claudeId = workspace.claudeTerminalId;
              const claudeAlive = !!claudeId && isPtyRunning(claudeId);
              if (claudeAlive && !hasTerminal(claudeId))
                startTerminal(claudeSpec({ ...workspace, claudeTerminalId: claudeId }));
              return {
                ...workspace,
                mode: claudeAlive ? "live" : "preview",
                claudeTerminalId: claudeAlive ? claudeId : null,
                shells,
                activeShellId: shells.some((shell) => shell.id === workspace.activeShellId)
                  ? workspace.activeShellId
                  : (shells[0]?.id ?? null),
                shellPanelOpen: workspace.shellPanelOpen && shells.length > 0,
              };
            }),
          })),
      };
    },
    {
      name: "claude-deck-workspaces",
      version: 2,
      partialize: (s) => ({ workspaces: s.workspaces, activeId: s.activeId }),
      migrate: (persisted) => persisted as Pick<WorkspaceState, "workspaces" | "activeId">,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<Pick<WorkspaceState, "workspaces" | "activeId">>;
        const workspaces = (saved.workspaces ?? []).map((w) => ({ ...blankWorkspace(w), ...w }));
        return { ...current, workspaces, activeId: saved.activeId ?? null };
      },
    },
  ),
);

export const getActiveWorkspace = () => {
  const { workspaces, activeId } = useWorkspaceStore.getState();
  return workspaces.find((w) => w.id === activeId) ?? null;
};

export const findWorkspace = (id: string) =>
  useWorkspaceStore.getState().workspaces.find((w) => w.id === id) ?? null;

export const findWorkspaceBySession = (sessionId: string) =>
  useWorkspaceStore.getState().workspaces.find((w) => w.sessionId === sessionId) ?? null;

export const useActiveWorkspace = () =>
  useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.activeId) ?? null);

export const referencedTerminalIds = () =>
  new Set(
    useWorkspaceStore
      .getState()
      .workspaces.flatMap((w) => [w.claudeTerminalId, ...w.shells.map((s) => s.id)])
      .filter((id): id is string => !!id),
  );
