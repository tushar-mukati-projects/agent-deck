import { ChevronDown, Plus, RotateCw, SquareTerminal, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { TerminalView } from "@/features/terminal/TerminalView";
import { terminalTone, useTerminal } from "@/hooks/useWorkspaceStatus";
import { shortcutLabel } from "@/lib/shortcuts";
import { clearTerminal, restartTerminal } from "@/lib/terminal/registry";
import { basename, cn } from "@/lib/utils";
import { useWorkspaceStore, type ShellTab, type WorkspaceRecord } from "@/stores/workspace-store";

const shellName = (program: string) => basename(program).replace(/\.exe$/i, "");

const ShellTabButton = ({
  workspace,
  shell,
  index,
}: {
  workspace: WorkspaceRecord;
  shell: ShellTab;
  index: number;
}) => {
  const terminal = useTerminal(shell.id);
  const tone = terminalTone(terminal);
  const active = workspace.activeShellId === shell.id;
  const { setActiveShell, closeShell } = useWorkspaceStore.getState();
  return (
    <div
      role="tab"
      aria-selected={active}
      title={shell.cwd}
      onClick={() => setActiveShell(workspace.id, shell.id)}
      onMouseDown={(e) => e.button === 1 && closeShell(workspace.id, shell.id)}
      className={cn(
        "group flex h-full cursor-default items-center gap-1.5 rounded-md px-2 text-[11.5px]",
        active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg",
      )}
    >
      {tone && <StatusDot tone={tone === "attention" ? "running" : tone} className="size-1.5" />}
      <span>
        {shellName(shell.program)} {index + 1}
      </span>
      {basename(shell.cwd) !== basename(workspace.cwd) && <span className="text-faint">· {basename(shell.cwd)}</span>}
      <button
        type="button"
        aria-label="Kill shell"
        onClick={(e) => {
          e.stopPropagation();
          closeShell(workspace.id, shell.id);
        }}
        className="flex size-4 items-center justify-center rounded text-faint opacity-0 group-hover:opacity-100 hover:text-fg"
      >
        <X className="size-3" />
      </button>
    </div>
  );
};

export const ShellPanel = ({ workspace }: { workspace: WorkspaceRecord }) => {
  const { openShell, setShellPanel } = useWorkspaceStore.getState();
  const activeId = workspace.activeShellId ?? workspace.shells[0]?.id ?? null;
  const active = useTerminal(activeId);

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-1 px-2 py-1">
        <SquareTerminal className="mr-1 size-3.5 text-faint" />
        <div className="no-scrollbar flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {workspace.shells.map((shell, index) => (
            <ShellTabButton key={shell.id} workspace={workspace} shell={shell} index={index} />
          ))}
        </div>
        <IconButton label="New shell" shortcut={shortcutLabel("newShell")} onClick={() => openShell(workspace.id)}>
          <Plus />
        </IconButton>
        {activeId && (
          <IconButton label="Clear" onClick={() => clearTerminal(activeId)}>
            <Trash2 />
          </IconButton>
        )}
        <IconButton label="Hide panel" shortcut={shortcutLabel("toggleShell")} onClick={() => setShellPanel(workspace.id, false)}>
          <ChevronDown />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1">
        {activeId && <TerminalView key={activeId} terminalId={activeId} autoFocus />}
        {active?.status === "exited" && activeId && (
          <div className="absolute right-3 bottom-3 flex items-center gap-2 rounded-lg border border-border-strong bg-panel/95 px-3 py-1.5 text-xs text-muted shadow-xl">
            Process exited{active.exitCode ? ` (${active.exitCode})` : ""}
            <Button size="sm" className="h-6" onClick={() => void restartTerminal(activeId)}>
              <RotateCw /> Restart
            </Button>
          </div>
        )}
        {active?.status === "error" && (
          <div className="absolute inset-x-3 top-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
            {active.error}
          </div>
        )}
      </div>
    </div>
  );
};
