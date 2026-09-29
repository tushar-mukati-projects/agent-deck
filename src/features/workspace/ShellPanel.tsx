import { ChevronDown, Plus, RotateCw, SquareTerminal, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Alert } from "@/components/ui/panel";
import { Tab, TabStrip } from "@/components/ui/tabs";
import { TerminalView } from "@/features/terminal/TerminalView";
import { terminalTone, useTerminal } from "@/hooks/useWorkspaceStatus";
import { shortcutLabel } from "@/lib/shortcuts";
import { clearTerminal } from "@/lib/terminal/registry";
import { basename, cn } from "@/lib/utils";
import { parseWslPath, shellQuote } from "@/lib/wsl";
import { useTerminalStore } from "@/stores/terminal-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ShellTab, Workspace } from "@/types";

const shellName = (shell: ShellTab, index: number) =>
  `${basename(shell.program).replace(/\.exe$/i, "")} ${index + 1}`;

const shellPath = (path: string) => {
  const wsl = parseWslPath(path);
  return wsl ? `${shellQuote(wsl.linuxPath)} ` : `"${path}" `;
};

const closeShellWithConfirm = async (workspaceId: string, shell: ShellTab, name: string) => {
  if (useTerminalStore.getState().terminals[shell.id]?.busy) {
    const confirmed = await useUiStore.getState().askConfirm({
      title: `Kill ${name}?`,
      description: "Something is still running in this shell. Closing it stops that process.",
      confirmLabel: "Kill shell",
      destructive: true,
    });
    if (!confirmed) return;
  }
  useWorkspaceStore.getState().closeShell(workspaceId, shell.id);
};

const ShellTabButton = ({
  workspace,
  shell,
  index,
}: {
  workspace: Workspace;
  shell: ShellTab;
  index: number;
}) => {
  const tone = terminalTone(useTerminal(shell.id));
  const active = workspace.activeShellId === shell.id;
  const name = shellName(shell, index);
  return (
    <Tab
      selected={active}
      onSelect={() => useWorkspaceStore.getState().setActiveShell(workspace.id, shell.id)}
      onClose={() => void closeShellWithConfirm(workspace.id, shell, name)}
      closeLabel={`Kill ${name}`}
      title={shell.cwd}
      className={cn(
        "h-full cursor-default rounded-md pr-0.5 pl-2 text-[11.5px]",
        active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg",
      )}
    >
      {tone && <StatusDot tone={tone === "attention" ? "running" : tone} className="size-1.5" />}
      <span className="max-w-[160px] truncate">{name}</span>
      {basename(shell.cwd) !== basename(workspace.cwd) && (
        <span className="text-faint">· {basename(shell.cwd)}</span>
      )}
    </Tab>
  );
};

export const ShellPanel = ({ workspace }: { workspace: Workspace }) => {
  const { openShell, setShellPanel, restartShell } = useWorkspaceStore.getState();
  const activeId = workspace.activeShellId ?? workspace.shells[0]?.id ?? null;
  const active = useTerminal(activeId);
  const activeShell = workspace.shells.find((s) => s.id === activeId);

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-1 px-2 py-1">
        <SquareTerminal className="mr-1 size-3.5 shrink-0 text-faint" />
        <TabStrip label="Shells" className="h-full min-w-0 flex-1 items-center gap-0.5">
          {workspace.shells.map((shell, index) => (
            <ShellTabButton key={shell.id} workspace={workspace} shell={shell} index={index} />
          ))}
        </TabStrip>
        <IconButton
          label="New shell"
          shortcut={shortcutLabel("newShell")}
          onClick={() => openShell(workspace.id)}
        >
          <Plus />
        </IconButton>
        {activeId && (
          <IconButton label="Clear" onClick={() => clearTerminal(activeId)}>
            <Trash2 />
          </IconButton>
        )}
        <IconButton
          label="Hide panel"
          shortcut={shortcutLabel("toggleShell")}
          onClick={() => setShellPanel(workspace.id, false)}
        >
          <ChevronDown />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        {activeShell && (
          <TerminalView key={activeShell.id} terminalId={activeShell.id} dropText={shellPath} />
        )}
        {active?.status === "exited" && activeShell && (
          <div className="absolute right-3 bottom-3 flex items-center gap-2 rounded-lg border border-border-strong bg-panel/95 px-3 py-1.5 text-xs text-muted shadow-xl shadow-shadow">
            Process exited{active.exitCode ? ` (${active.exitCode})` : ""}
            <Button size="xs" onClick={() => restartShell(workspace.id, activeShell.id)}>
              <RotateCw /> Restart
            </Button>
          </div>
        )}
        {active?.status === "error" && (
          <Alert tone="danger" className="absolute inset-x-3 top-3 font-mono">
            {active.error}
          </Alert>
        )}
      </div>
    </div>
  );
};
