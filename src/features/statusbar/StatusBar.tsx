import { Bell, Bot, FolderOpen, GitBranch, Hash, SquareTerminal } from "lucide-react";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";

import { focusNextAttention, toggleShellPanel } from "@/actions/workspaces";
import { StatusDot } from "@/components/ui/feedback";
import { DeckPet } from "@/features/statusbar/DeckPet";
import { shortcutLabel } from "@/lib/shortcuts";
import { copyText } from "@/lib/tauri/system";
import { shortenHome } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { useActiveWorkspace } from "@/stores/workspace-store";
import { useAgentShells, useSubagents } from "@/hooks/useAgentShells";
import type { TerminalState, Workspace } from "@/types";

const Item = ({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode;
  title?: string;
  onClick?: () => void;
}) => (
  <button
    type="button"
    title={title}
    onClick={onClick}
    disabled={!onClick}
    className="flex h-full min-w-0 items-center gap-1.5 px-2 text-faint transition-colors enabled:hover:bg-hover enabled:hover:text-fg [&_svg]:size-3 [&_svg]:shrink-0"
  >
    {children}
  </button>
);

const agentCounts = (terminals: Record<string, TerminalState>) => {
  const agents = Object.values(terminals).filter(
    (t) => t.kind === "agent" && t.status === "running",
  );
  return [
    agents.length,
    agents.filter((t) => t.busy).length,
    agents.filter((t) => t.attention).length,
  ];
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const ShellItem = ({ workspace }: { workspace: Workspace }) => {
  const agentRunning = useAgentShells(workspace).filter((t) => t.status === "running").length;
  const own = workspace.shells.length;
  const parts = [own > 0 && plural(own, "shell"), agentRunning > 0 && `${agentRunning} by agent`];
  return (
    <Item title={`Toggle shell panel (${shortcutLabel("toggleShell")})`} onClick={toggleShellPanel}>
      <SquareTerminal />
      {parts.filter(Boolean).join(" · ") || "Shell"}
    </Item>
  );
};

const SubagentsItem = ({ workspace }: { workspace: Workspace }) => {
  const running = useSubagents(workspace).length;
  const open = useUiStore((s) => s.subagentsOpen);
  if (running === 0) return null;
  return (
    <Item
      title={open ? "Hide subagents" : "Show what the subagents are doing"}
      onClick={() => useUiStore.getState().setSubagentsOpen(!open)}
    >
      <Bot className="text-info" />
      {plural(running, "subagent")}
    </Item>
  );
};

export const StatusBar = () => {
  const workspace = useActiveWorkspace();
  const session = useSessionsStore((s) => (workspace ? s.byId[workspace.sessionId] : undefined));
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const hidden = useSettingsStore((s) => s.hideMode);
  const pet = useSettingsStore((s) => s.pet);
  const [agentsRunning, agentsBusy, waiting] = useTerminalStore(
    useShallow((s) => agentCounts(s.terminals)),
  );

  return (
    <footer className="flex h-6 shrink-0 items-stretch justify-between border-t border-border bg-chrome text-[11px]">
      <div className="flex min-w-0 items-stretch">
        {workspace && (
          <>
            <Item
              title={workspace.cwd}
              onClick={() => void copyText(workspace.cwd).then(() => toast.success("Path copied"))}
            >
              <FolderOpen />
              <span className="truncate">{shortenHome(workspace.cwd, home)}</span>
            </Item>
            {session?.gitBranch && session.gitBranch !== "HEAD" && (
              <Item title={session.gitBranch}>
                <GitBranch />
                <span className="max-w-[220px] truncate">{session.gitBranch}</span>
              </Item>
            )}
            {!hidden && (
              <Item
                title="Copy session ID"
                onClick={() =>
                  void copyText(workspace.sessionId).then(() => toast.success("Session ID copied"))
                }
              >
                <Hash />
                <span className="font-mono">{workspace.sessionId.slice(0, 8)}</span>
              </Item>
            )}
            <ShellItem workspace={workspace} />
            {!hidden && <SubagentsItem workspace={workspace} />}
          </>
        )}
      </div>
      <div className="flex shrink-0 items-stretch">
        {!hidden && waiting > 0 && (
          <Item
            title={`Jump to the session waiting for you (${shortcutLabel("nextAttention")})`}
            onClick={focusNextAttention}
          >
            <Bell className="text-accent" />
            <span className="text-fg">{waiting} waiting for you</span>
          </Item>
        )}
        {!hidden && agentsRunning > 0 && (
          <Item title="Agent sessions running in Deck">
            <StatusDot tone={agentsBusy > 0 ? "busy" : "running"} className="size-1.5" />
            {agentsRunning} running{agentsBusy > 0 ? ` · ${agentsBusy} working` : ""}
          </Item>
        )}
        {!hidden && pet && <DeckPet busy={agentsBusy} waiting={waiting} />}
      </div>
    </footer>
  );
};
