import { AlertTriangle, RotateCw, X } from "lucide-react";

import { closeWorkspace } from "@/actions/workspaces";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { TerminalView } from "@/features/terminal/TerminalView";
import { useTerminal } from "@/hooks/useWorkspaceStatus";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

export const ClaudePane = ({ workspace }: { workspace: Workspace }) => {
  const terminalId = workspace.claudeTerminalId;
  const terminal = useTerminal(terminalId);
  const restartClaude = useWorkspaceStore((s) => s.restartClaude);
  if (!terminalId) return null;

  return (
    <div className="relative h-full w-full">
      <TerminalView terminalId={terminalId} dropRoot={workspace.cwd} />

      {terminal?.status === "starting" && (
        <div className="pointer-events-none absolute top-3 right-4 flex items-center gap-2 rounded-md border border-border bg-panel/90 px-2.5 py-1 text-[11.5px] text-muted">
          <Spinner className="size-3" /> Starting Claude…
        </div>
      )}

      {terminal?.status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-bg/80 p-4 backdrop-blur-sm">
          <div className="animate-pop-in w-[min(440px,100%)] rounded-xl border border-border-strong bg-panel p-5 shadow-2xl">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-fg">
              <AlertTriangle className="size-4 text-danger" /> Couldn't start Claude
            </div>
            <p className="mt-2 font-mono text-xs leading-relaxed break-words text-muted select-text">
              {terminal.error}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => void closeWorkspace(workspace.id)}>
                Close tab
              </Button>
              <Button size="sm" variant="primary" onClick={() => restartClaude(workspace.id)}>
                <RotateCw /> Try again
              </Button>
            </div>
          </div>
        </div>
      )}

      {terminal?.status === "exited" && (
        <div className="animate-pop-in absolute right-4 bottom-4 left-4 mx-auto flex max-w-[560px] flex-wrap items-center gap-3 rounded-xl border border-border-strong bg-panel/95 px-4 py-2.5 shadow-2xl backdrop-blur">
          <span className="size-2 rounded-full bg-faint" />
          <span className="min-w-0 flex-1 text-[12.5px] text-muted">
            Claude exited{terminal.exitCode ? ` with code ${terminal.exitCode}` : ""}. The
            conversation is saved.
          </span>
          <Button size="sm" variant="primary" onClick={() => restartClaude(workspace.id)}>
            <RotateCw /> Resume again
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void closeWorkspace(workspace.id)}>
            <X /> Close
          </Button>
        </div>
      )}
    </div>
  );
};
