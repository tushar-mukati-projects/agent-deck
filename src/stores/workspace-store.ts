import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  disposeTerminal,
  hasTerminal,
  isPtyRunning,
  restartTerminal,
  startTerminal,
  type TerminalSpec,
} from "@/lib/terminal/registry";
import { basename, newId, samePath } from "@/lib/utils";
import { parseWslPath, shellQuote } from "@/lib/wsl";
import { parseArgs, useSettingsStore } from "@/stores/settings-store";
import { useSessionsStore } from "@/stores/sessions-store";
import type { SessionInfo, Workspace } from "@/types";

export interface ShellTab {
  id: string;
  cwd: string;
  program: string;
}

export interface WorkspaceRecord extends Workspace {
  claudeArgs: string[];
  shells: ShellTab[];
}

interface ResumeOptions {
  fork?: boolean;
}

interface WorkspaceState {
  workspaces: WorkspaceRecord[];
  activeId: string | null;
  openSession: (session: SessionInfo, options?: { resume?: boolean }) => void;
  resume: (workspaceId: string, options?: ResumeOptions) => void;
  newSession: (cwd: string) => void;
  restartClaude: (workspaceId: string) => void;
  close: (workspaceId: string) => Promise<void>;
  activate: (workspaceId: string) => void;
  cycle: (direction: 1 | -1) => void;
  reorder: (fromId: string, toId: string) => void;
  openShell: (workspaceId: string, cwd?: string) => void;
  closeShell: (workspaceId: string, shellId: string) => void;
  setActiveShell: (workspaceId: string, shellId: string) => void;
  setShellPanel: (workspaceId: string, open: boolean) => void;
  openFile: (workspaceId: string, path: string) => void;
  closeFile: (workspaceId: string, path: string) => void;
  setActiveFile: (workspaceId: string, path: string) => void;
  syncTitles: (byId: Record<string, SessionInfo>) => void;
  restore: () => void;
}

const claudeArgs = () => parseArgs(useSettingsStore.getState().claudeArgs);

const shellProgram = () => {
  const override = useSettingsStore.getState().shellProgram.trim();
  return override || useSessionsStore.getState().environment?.shell || "powershell.exe";
};

const windowsHome = () => useSessionsStore.getState().environment?.home ?? "C:\\";

const wslLaunch = (hostCwd: string, command: string[] | null) => {
  const location = parseWslPath(hostCwd);
  if (!location) return null;
  const base = ["-d", location.distro, "--cd", location.linuxPath];
  if (!command) return { cwd: windowsHome(), program: "wsl.exe", args: base };
  const loginShell = useSessionsStore.getState().wslShells[location.distro] ?? "/bin/bash";
  const script = `exec ${command.map(shellQuote).join(" ")}`;
  return { cwd: windowsHome(), program: "wsl.exe", args: [...base, "-e", loginShell, "-lic", script] };
};

const claudeSpec = (workspace: WorkspaceRecord): TerminalSpec => ({
  id: workspace.claudeTerminalId ?? workspace.id,
  kind: "claude",
  workspaceId: workspace.id,
  ...(wslLaunch(workspace.cwd, ["claude", ...workspace.claudeArgs]) ?? {
    cwd: workspace.cwd,
    program: "claude",
    args: workspace.claudeArgs,
  }),
});

const shellSpec = (workspaceId: string, shell: ShellTab): TerminalSpec => ({
  id: shell.id,
  kind: "shell",
  workspaceId,
  ...(wslLaunch(shell.cwd, null) ?? { cwd: shell.cwd, program: shell.program, args: [] }),
});

const sessionExists = (sessionId: string) => !!useSessionsStore.getState().byId[sessionId];

const resumeArgs = (sessionId: string, fork: boolean) => {
  if (!sessionExists(sessionId)) return ["--session-id", sessionId, ...claudeArgs()];
  return fork
    ? ["--resume", sessionId, "--fork-session", "--session-id", newId(), ...claudeArgs()]
    : ["--resume", sessionId, ...claudeArgs()];
};

const workspaceFromSession = (session: SessionInfo): WorkspaceRecord => ({
  id: session.id,
  sessionId: session.id,
  cwd: session.cwd,
  title: session.title ?? basename(session.cwd),
  filePath: session.filePath,
  mode: "preview",
  claudeTerminalId: null,
  claudeArgs: [],
  shells: [],
  activeShellId: null,
  shellPanelOpen: false,
  openFiles: [],
  activeFile: null,
});

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => {
      const patch = (id: string, update: (w: WorkspaceRecord) => Partial<WorkspaceRecord>) =>
        set((s) => ({
          workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...update(w) } : w)),
        }));

      const find = (id: string) => get().workspaces.find((w) => w.id === id);

      const launchClaude = (workspace: WorkspaceRecord, args: string[]) => {
        const terminalId = newId();
        const next: WorkspaceRecord = {
          ...workspace,
          mode: "live",
          claudeTerminalId: terminalId,
          claudeArgs: args,
        };
        const forkedId = args[args.indexOf("--fork-session") + 2];
        if (args.includes("--fork-session") && forkedId) {
          next.sessionId = forkedId;
          next.title = `${workspace.title} (fork)`;
        }
        startTerminal(claudeSpec(next));
        return next;
      };

      return {
        workspaces: [],
        activeId: null,

        openSession: (session, options) => {
          const existing = get().workspaces.find((w) => w.sessionId === session.id);
          if (existing) {
            set({ activeId: existing.id });
            if (options?.resume && existing.mode === "preview") get().resume(existing.id);
            return;
          }
          const workspace = workspaceFromSession(session);
          set((s) => ({ workspaces: [...s.workspaces, workspace], activeId: workspace.id }));
          if (options?.resume) get().resume(workspace.id);
        },

        resume: (workspaceId, options) => {
          const workspace = find(workspaceId);
          if (!workspace) return;
          const fork = !!options?.fork;
          if (workspace.mode === "live" && !fork) {
            set({ activeId: workspaceId });
            return;
          }
          const args = resumeArgs(workspace.sessionId, fork);
          if (fork) {
            const source = useSessionsStore.getState().byId[workspace.sessionId];
            const base = source ? workspaceFromSession(source) : workspace;
            const forked = launchClaude({ ...base, id: newId(), shells: [] }, args);
            set((s) => ({ workspaces: [...s.workspaces, forked], activeId: forked.id }));
            return;
          }
          const next = launchClaude(workspace, args);
          set((s) => ({
            workspaces: s.workspaces.map((w) => (w.id === workspaceId ? next : w)),
            activeId: workspaceId,
          }));
        },

        newSession: (cwd) => {
          const sessionId = newId();
          const base: WorkspaceRecord = {
            ...workspaceFromSession({
              id: sessionId,
              distro: parseWslPath(cwd)?.distro ?? null,
              cwd,
              filePath: "",
              projectKey: "",
              title: null,
              customTitle: null,
              firstPrompt: null,
              lastPrompt: null,
              gitBranch: null,
              startedAt: null,
              lastMessageAt: null,
              modifiedMs: Date.now(),
              promptCount: 0,
              size: 0,
              version: null,
            }),
            title: "New session",
            filePath: null,
          };
          const workspace = launchClaude(base, ["--session-id", sessionId, ...claudeArgs()]);
          set((s) => ({ workspaces: [...s.workspaces, workspace], activeId: workspace.id }));
        },

        restartClaude: (workspaceId) => {
          const workspace = find(workspaceId);
          if (!workspace?.claudeTerminalId) return;
          const args = resumeArgs(workspace.sessionId, false);
          patch(workspaceId, () => ({ claudeArgs: args }));
          void restartTerminal(workspace.claudeTerminalId, { args });
        },

        close: async (workspaceId) => {
          const { workspaces, activeId } = get();
          const index = workspaces.findIndex((w) => w.id === workspaceId);
          const workspace = workspaces[index];
          if (!workspace) return;
          const remaining = workspaces.filter((w) => w.id !== workspaceId);
          const neighbor = remaining[Math.min(index, remaining.length - 1)]?.id ?? null;
          set({ workspaces: remaining, activeId: activeId === workspaceId ? neighbor : activeId });
          const terminalIds = [workspace.claudeTerminalId, ...workspace.shells.map((s) => s.id)];
          await Promise.all(terminalIds.filter((id): id is string => !!id).map(disposeTerminal));
        },

        activate: (workspaceId) => set({ activeId: workspaceId }),

        cycle: (direction) => {
          const { workspaces, activeId } = get();
          if (workspaces.length < 2) return;
          const index = workspaces.findIndex((w) => w.id === activeId);
          const next = (index + direction + workspaces.length) % workspaces.length;
          set({ activeId: workspaces[next].id });
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

        openShell: (workspaceId, cwd) => {
          const workspace = find(workspaceId);
          if (!workspace) return;
          const shellCwd = cwd ?? workspace.cwd;
          const program = parseWslPath(shellCwd) ? "wsl.exe" : shellProgram();
          const shell: ShellTab = { id: newId(), cwd: shellCwd, program };
          startTerminal(shellSpec(workspaceId, shell));
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
              activeShellId: w.activeShellId === shellId ? (shells.at(-1)?.id ?? null) : w.activeShellId,
              shellPanelOpen: shells.length > 0 && w.shellPanelOpen,
            };
          });
        },

        setActiveShell: (workspaceId, shellId) => patch(workspaceId, () => ({ activeShellId: shellId })),

        setShellPanel: (workspaceId, open) => {
          const workspace = find(workspaceId);
          if (!workspace) return;
          if (open && workspace.shells.length === 0) {
            get().openShell(workspaceId);
            return;
          }
          patch(workspaceId, () => ({ shellPanelOpen: open }));
        },

        openFile: (workspaceId, path) =>
          patch(workspaceId, (w) => ({
            openFiles: w.openFiles.some((f) => samePath(f, path)) ? w.openFiles : [...w.openFiles, path],
            activeFile: path,
          })),

        closeFile: (workspaceId, path) =>
          patch(workspaceId, (w) => {
            const index = w.openFiles.findIndex((f) => samePath(f, path));
            const openFiles = w.openFiles.filter((f) => !samePath(f, path));
            const activeFile =
              w.activeFile && samePath(w.activeFile, path)
                ? (openFiles[Math.min(index, openFiles.length - 1)] ?? null)
                : w.activeFile;
            return { openFiles, activeFile };
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
              shells.forEach((shell) => hasTerminal(shell.id) || startTerminal(shellSpec(workspace.id, shell)));
              const claudeAlive = !!workspace.claudeTerminalId && isPtyRunning(workspace.claudeTerminalId);
              if (claudeAlive && !hasTerminal(workspace.claudeTerminalId!)) startTerminal(claudeSpec(workspace));
              return {
                ...workspace,
                mode: claudeAlive ? "live" : "preview",
                claudeTerminalId: claudeAlive ? workspace.claudeTerminalId : null,
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
      version: 1,
      partialize: (s) => ({ workspaces: s.workspaces, activeId: s.activeId }),
    },
  ),
);

export const useActiveWorkspace = () =>
  useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.activeId) ?? null);
