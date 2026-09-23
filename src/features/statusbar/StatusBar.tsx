import { useMemo } from "react";
import { Bell, Cpu, FolderOpen, GitBranch, Hash, SquareTerminal } from "lucide-react";
import { toast } from "sonner";

import { focusNextAttention, toggleShellPanel } from "@/actions/workspaces";
import { StatusDot } from "@/components/ui/feedback";
import { shortcutLabel } from "@/lib/shortcuts";
import { copyText } from "@/lib/tauri/system";
import { shortenHome } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useActiveWorkspace } from "@/stores/workspace-store";

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

export const StatusBar = () => {
  const workspace = useActiveWorkspace();
  const session = useSessionsStore((s) => (workspace ? s.byId[workspace.sessionId] : undefined));
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const sessionCount = useSessionsStore((s) => s.sessions.length);
  const terminals = useTerminalStore((s) => s.terminals);

  const { claudeRunning, claudeBusy, shells, waiting } = useMemo(() => {
    const list = Object.values(terminals).filter((t) => t.status === "running");
    return {
      waiting: list.filter((t) => t.kind === "claude" && t.attention).length,
      claudeRunning: list.filter((t) => t.kind === "claude").length,
      claudeBusy: list.filter((t) => t.kind === "claude" && t.busy).length,
      shells: list.filter((t) => t.kind === "shell").length,
    };
  }, [terminals]);

  return (
    <footer className="flex h-6 shrink-0 items-stretch justify-between border-t border-border bg-panel text-[11px]">
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
              <Item>
                <GitBranch />
                {session.gitBranch}
              </Item>
            )}
            <Item
              title="Copy session ID"
              onClick={() =>
                void copyText(workspace.sessionId).then(() => toast.success("Session ID copied"))
              }
            >
              <Hash />
              <span className="font-mono">{workspace.sessionId.slice(0, 8)}</span>
            </Item>
            <Item
              title={`Toggle shell panel (${shortcutLabel("toggleShell")})`}
              onClick={toggleShellPanel}
            >
              <SquareTerminal />
              {workspace.shells.length > 0
                ? `${workspace.shells.length} shell${workspace.shells.length > 1 ? "s" : ""}`
                : "Shell"}
            </Item>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-stretch">
        {waiting > 0 && (
          <Item
            title={`Jump to the session waiting for you (${shortcutLabel("nextAttention")})`}
            onClick={focusNextAttention}
          >
            <Bell className="text-accent" />
            <span className="text-fg">{waiting} waiting for you</span>
          </Item>
        )}
        {claudeRunning > 0 && (
          <Item title="Claude sessions running in Deck">
            <StatusDot tone={claudeBusy > 0 ? "busy" : "running"} className="size-1.5" />
            {claudeRunning} running{claudeBusy > 0 ? ` · ${claudeBusy} working` : ""}
          </Item>
        )}
        {shells > 0 && (
          <Item>
            <Cpu />
            {shells} shell{shells > 1 ? "s" : ""}
          </Item>
        )}
        <Item>{sessionCount} sessions</Item>
      </div>
    </footer>
  );
};
