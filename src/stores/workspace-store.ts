import { toast } from "sonner";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { adoptSessions } from "@/lib/adopt";
import {
  agentSpec,
  defaultShellProgram,
  isPersisted,
  planLaunch,
  shellSpec,
  type LaunchPlan,
} from "@/lib/agents/launch";
import { agentName, CLAUDE, findAgent, getAgent } from "@/lib/agents/registry";
import {
  disposeTerminal,
  hasTerminal,
  isPtyRunning,
  requestFocus,
  restartTerminal,
  startTerminal,
  type TerminalSpec,
} from "@/lib/terminal/registry";
import { neighborAt, newId, samePath } from "@/lib/utils";
import { parseWslPath } from "@/lib/wsl";
import {
  blankWorkspace,
  workspaceFromSession,
  workspaceTerminalIds,
} from "@/stores/workspace-factory";
import { restoredWorkspace, restoreSaved } from "@/stores/workspace-persist";
import type { AgentId, SessionInfo, ShellTab, Workspace } from "@/types";

interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string | null;
  recentlyClosed: string[];
  openSession: (session: SessionInfo) => string;
  launch: (workspaceId: string) => void;
  fork: (source: Workspace) => void;
  newSession: (cwd: string, options?: NewSessionOptions) => void;
  restartAgent: (workspaceId: string, focus?: boolean) => void;
  close: (workspaceId: string) => Promise<void>;
  activate: (workspaceId: string) => void;
  cycle: (direction: 1 | -1) => void;
  reorder: (fromId: string, toId: string) => void;
  openShell: (workspaceId: string, cwd?: string) => void;
  closeShell: (workspaceId: string, shellId: string) => void;
  restartShell: (workspaceId: string, shellId: string) => void;
  setActiveShell: (workspaceId: string, shellId: string) => void;
  setShellPanel: (workspaceId: string, open: boolean, spawn?: boolean) => void;
  collapseShellPanel: (workspaceId: string) => void;
  openFile: (workspaceId: string, path: string) => void;
  closeFile: (workspaceId: string, path: string) => void;
  setActiveFile: (workspaceId: string, path: string) => void;
  syncSessions: (byId: Record<string, SessionInfo>) => void;
  restore: () => void;
}

interface NewSessionOptions {
  agent?: AgentId;
  subagent?: string;
}

const RECENTLY_CLOSED_LIMIT = 20;

const launchFields = (plan: LaunchPlan) => ({
  agentArgs: plan.args,
  pendingSince: plan.pending ? Date.now() : null,
});

const withAgent = (workspace: Workspace, plan: LaunchPlan) => {
  const next = {
    ...workspace,
    ...launchFields(plan),
    mode: "live" as const,
    agentTerminalId: newId(),
  };
  startTerminal(agentSpec(next), { focus: true });
  return next;
};

const focusAgent = (workspace: Workspace) => {
  if (workspace.mode === "live" && workspace.agentTerminalId)
    requestFocus(workspace.agentTerminalId);
};

const agentAvailable = (agent: AgentId) => {
  if (getAgent(agent)) return true;
  toast.error("This session's agent was removed in Settings. Add it again to start it.");
  return false;
};

const newSessionTitle = (agent: AgentId, subagent?: string) => {
  if (subagent) return `New ${subagent} session`;
  return agent === CLAUDE ? "New session" : `New ${agentName(agent)} session`;
};

const terminalSpecs = (workspace: Workspace): TerminalSpec[] => [
  ...(workspace.agentTerminalId
    ? [agentSpec({ ...workspace, agentTerminalId: workspace.agentTerminalId })]
    : []),
  ...workspace.shells.map((shell) => shellSpec(workspace.id, shell)),
];

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

        launch: (workspaceId) => {
          const workspace = find(workspaceId);
          if (!workspace || !agentAvailable(workspace.agent)) return;
          if (workspace.mode === "live") {
            get().activate(workspaceId);
            return;
          }
          const next = withAgent(workspace, planLaunch(workspace));
          set((s) => ({
            workspaces: s.workspaces.map((w) => (w.id === workspaceId ? next : w)),
            activeId: workspaceId,
          }));
        },

        fork: (source) => {
          if (!agentAvailable(source.agent)) return;
          if (!findAgent(source.agent).canFork) {
            toast.error(`${agentName(source.agent)} sessions can't be forked.`);
            return;
          }
          if (!isPersisted(source)) {
            toast.error("Nothing to fork yet — send a prompt in this session first.");
            return;
          }
          const plan = planLaunch(source, { fork: true });
          const base = blankWorkspace({
            id: newId(),
            sessionId: plan.sessionId,
            cwd: source.cwd,
            title: `${source.title} (fork)`,
            filePath: null,
            agent: source.agent,
          });
          add(withAgent(base, plan));
        },

        newSession: (cwd, { agent = CLAUDE, subagent } = {}) => {
          if (!agentAvailable(agent)) return;
          const sessionId = newId();
          const base = blankWorkspace({
            id: sessionId,
            sessionId,
            cwd,
            title: newSessionTitle(agent, subagent),
            filePath: null,
            agent,
          });
          add(withAgent(base, planLaunch(base, { subagent })));
        },

        restartAgent: (workspaceId, focus = true) => {
          const workspace = find(workspaceId);
          const terminalId = workspace?.agentTerminalId;
          if (!workspace || !terminalId || !agentAvailable(workspace.agent)) return;
          const fields = launchFields(planLaunch(workspace));
          patch(workspaceId, () => fields);
          if (focus) requestFocus(terminalId);
          void restartTerminal(
            terminalId,
            agentSpec({ ...workspace, ...fields, agentTerminalId: terminalId }),
          );
        },

        close: async (workspaceId) => {
          const { workspaces, activeId } = get();
          const index = workspaces.findIndex((w) => w.id === workspaceId);
          const workspace = workspaces[index];
          if (!workspace) return;
          const remaining = workspaces.filter((w) => w.id !== workspaceId);
          const neighbor = neighborAt(remaining, index) ?? null;
          const closingActive = activeId === workspaceId;
          set((s) => ({
            workspaces: remaining,
            activeId: closingActive ? (neighbor?.id ?? null) : activeId,
            recentlyClosed: [
              workspace.sessionId,
              ...s.recentlyClosed.filter((id) => id !== workspace.sessionId),
            ].slice(0, RECENTLY_CLOSED_LIMIT),
          }));
          if (closingActive && neighbor) focusAgent(neighbor);
          await Promise.all(workspaceTerminalIds(workspace).map(disposeTerminal));
        },

        activate: (workspaceId) => {
          set({ activeId: workspaceId });
          const workspace = find(workspaceId);
          if (workspace) focusAgent(workspace);
        },

        cycle: (direction) => {
          const { workspaces, activeId } = get();
          if (!workspaces.length) return;
          const index = workspaces.findIndex((w) => w.id === activeId);
          const next =
            index < 0
              ? direction > 0
                ? 0
                : workspaces.length - 1
              : (index + direction + workspaces.length) % workspaces.length;
          if (next !== index) get().activate(workspaces[next].id);
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
          const root = cwd ?? workspace.cwd;
          const shell: ShellTab = {
            id: newId(),
            cwd: root,
            program: parseWslPath(root) ? "wsl.exe" : defaultShellProgram(),
          };
          startTerminal(shellSpec(workspaceId, shell), { focus: true });
          patch(workspaceId, (w) => ({
            shells: [...w.shells, shell],
            activeShellId: shell.id,
            shellPanelOpen: true,
          }));
        },

        closeShell: (workspaceId, shellId) => {
          const workspace = find(workspaceId);
          if (!workspace) return;
          void disposeTerminal(shellId);
          const index = workspace.shells.findIndex((s) => s.id === shellId);
          const shells = workspace.shells.filter((s) => s.id !== shellId);
          const activeShellId =
            workspace.activeShellId === shellId
              ? (neighborAt(shells, index)?.id ?? null)
              : workspace.activeShellId;
          const shellPanelOpen = shells.length > 0 && workspace.shellPanelOpen;
          patch(workspaceId, () => ({ shells, activeShellId, shellPanelOpen }));
          const focusId = shellPanelOpen ? activeShellId : workspace.agentTerminalId;
          if (focusId) requestFocus(focusId);
        },

        restartShell: (workspaceId, shellId) => {
          const shell = find(workspaceId)?.shells.find((s) => s.id === shellId);
          if (!shell) return;
          requestFocus(shellId);
          void restartTerminal(shellId, shellSpec(workspaceId, shell));
        },

        setActiveShell: (workspaceId, shellId) => {
          requestFocus(shellId);
          patch(workspaceId, () => ({ activeShellId: shellId }));
        },

        setShellPanel: (workspaceId, open, spawn = true) => {
          const workspace = find(workspaceId);
          if (!workspace) return;
          if (open && spawn && workspace.shells.length === 0) {
            get().openShell(workspaceId);
            return;
          }
          if (open && workspace.activeShellId) requestFocus(workspace.activeShellId);
          if (!open && workspace.agentTerminalId) requestFocus(workspace.agentTerminalId);
          patch(workspaceId, () => ({ shellPanelOpen: open }));
        },

        collapseShellPanel: (workspaceId) => patch(workspaceId, () => ({ shellPanelOpen: false })),

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
                ? (neighborAt(openFiles, index) ?? null)
                : w.activeFile,
            };
          }),

        setActiveFile: (workspaceId, path) => patch(workspaceId, () => ({ activeFile: path })),

        syncSessions: (byId) =>
          set((s) => {
            const adopted = adoptSessions(s.workspaces, byId);
            let changed = adopted !== s.workspaces;
            const workspaces = adopted.map((w) => {
              const session = byId[w.sessionId];
              if (!session) return w;
              const title = session.title ?? w.title;
              if (title === w.title && session.filePath === w.filePath) return w;
              changed = true;
              return { ...w, title, filePath: session.filePath };
            });
            return changed ? { workspaces } : s;
          }),

        restore: () => {
          const workspaces = get().workspaces.map((w) => restoredWorkspace(w, isPtyRunning));
          set({ workspaces });
          for (const spec of workspaces.flatMap(terminalSpecs))
            if (!hasTerminal(spec.id)) startTerminal(spec);
        },
      };
    },
    {
      name: "agent-deck-workspaces",
      version: 3,
      partialize: (s) => ({ workspaces: s.workspaces, activeId: s.activeId }),
      merge: (persisted, current) => ({ ...current, ...restoreSaved(persisted) }),
    },
  ),
);

export const activeWorkspaceOf = ({
  workspaces,
  activeId,
}: Pick<WorkspaceState, "workspaces" | "activeId">) =>
  workspaces.find((w) => w.id === activeId) ?? null;

export const getActiveWorkspace = () => activeWorkspaceOf(useWorkspaceStore.getState());

export const findWorkspace = (id: string) =>
  useWorkspaceStore.getState().workspaces.find((w) => w.id === id) ?? null;

export const findWorkspaceBySession = (sessionId: string) =>
  useWorkspaceStore.getState().workspaces.find((w) => w.sessionId === sessionId) ?? null;

export const useWorkspace = (id: string | null) =>
  useWorkspaceStore((s) => (id ? (s.workspaces.find((w) => w.id === id) ?? null) : null));

export const useActiveWorkspace = () => useWorkspaceStore(activeWorkspaceOf);

export const referencedTerminalIds = () =>
  new Set(useWorkspaceStore.getState().workspaces.flatMap(workspaceTerminalIds));
