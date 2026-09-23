import { ChevronDown, Play, Plus, RotateCw, SquareTerminal, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { TerminalView } from "@/features/terminal/TerminalView";
import { terminalTone, useTerminal } from "@/hooks/useWorkspaceStatus";
import { shortcutLabel } from "@/lib/shortcuts";
import { clearTerminal, restartTerminal } from "@/lib/terminal/registry";
import { basename, cn } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { ShellTab, Workspace } from "@/types";

const shellName = (shell: ShellTab, index: number) =>
  shell.label ?? `${basename(shell.program).replace(/\.exe$/i, "")} ${index + 1}`;

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
  const { setActiveShell, closeShell } = useWorkspaceStore.getState();
  return (
    <div
      role="tab"
      tabIndex={0}
      aria-selected={active}
      title={shell.command ? `${shell.command} — ${shell.cwd}` : shell.cwd}
      onClick={() => setActiveShell(workspace.id, shell.id)}
      onKeyDown={(e) => e.key === "Enter" && setActiveShell(workspace.id, shell.id)}
      onAuxClick={(e) => e.button === 1 && closeShell(workspace.id, shell.id)}
      className={cn(
        "group flex h-full shrink-0 cursor-default items-center gap-1.5 rounded-md px-2 text-[11.5px]",
        active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg",
      )}
    >
      {shell.command ? <Play className="size-2.5 shrink-0 fill-current text-faint" /> : null}
      {tone && <StatusDot tone={tone === "attention" ? "running" : tone} className="size-1.5" />}
      <span className="max-w-[160px] truncate">{shellName(shell, index)}</span>
      {basename(shell.cwd) !== basename(workspace.cwd) && (
        <span className="text-faint">· {basename(shell.cwd)}</span>
      )}
      <button
        type="button"
        aria-label="Kill shell"
        onClick={(e) => {
          e.stopPropagation();
          closeShell(workspace.id, shell.id);
        }}
        className="flex size-4 items-center justify-center rounded text-faint opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 hover:text-fg"
      >
        <X className="size-3" />
      </button>
    </div>
  );
};

export const ShellPanel = ({ workspace }: { workspace: Workspace }) => {
  const { openShell, setShellPanel } = useWorkspaceStore.getState();
  const activeId = workspace.activeShellId ?? workspace.shells[0]?.id ?? null;
  const active = useTerminal(activeId);
  const activeShell = workspace.shells.find((s) => s.id === activeId);

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border bg-bg">
      <div className="flex h-8 shrink-0 items-center gap-1 px-2 py-1">
        <SquareTerminal className="mr-1 size-3.5 shrink-0 text-faint" />
        <div
          role="tablist"
          className="no-scrollbar flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {workspace.shells.map((shell, index) => (
            <ShellTabButton key={shell.id} workspace={workspace} shell={shell} index={index} />
          ))}
        </div>
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
        {activeId && (
          <TerminalView key={activeId} terminalId={activeId} dropRoot={activeShell?.cwd} />
        )}
        {active?.status === "exited" && activeId && (
          <div className="absolute right-3 bottom-3 flex items-center gap-2 rounded-lg border border-border-strong bg-panel/95 px-3 py-1.5 text-xs text-muted shadow-xl">
            {activeShell?.command ? `“${activeShell.label}” finished` : "Process exited"}
            {active.exitCode ? ` (${active.exitCode})` : ""}
            <Button size="sm" className="h-6" onClick={() => void restartTerminal(activeId)}>
              <RotateCw /> {activeShell?.command ? "Run again" : "Restart"}
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
