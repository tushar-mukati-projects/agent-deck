import { useMemo, useState } from "react";
import { ArrowDown, Copy, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/feedback";
import { Alert } from "@/components/ui/panel";
import { TimeAgo } from "@/components/ui/time-ago";
import { useStickToBottom } from "@/features/workspace/useStickToBottom";
import { usePolling } from "@/hooks/usePolling";
import { cleanOutput, type TaskState } from "@/lib/agent-tasks";
import { api } from "@/lib/tauri/commands";
import { copyText } from "@/lib/tauri/system";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { AgentTask, FileTail } from "@/types";

const OUTPUT_BYTES = 64 * 1024;
const POLL_MS = 1000;

const STATE_LABEL: Record<TaskState, string> = {
  running: "Running",
  completed: "Finished",
  failed: "Failed",
  killed: "Stopped by the agent",
  stopped: "Stopped",
  ended: "Ended with the session",
};

const useOutput = (path: string | null, live: boolean) => {
  const [tail, setTail] = useState<FileTail | null>(null);
  const error = usePolling(
    path
      ? () => async (active) => {
          const next = await api.readTail(path, OUTPUT_BYTES);
          if (!active()) return;
          setTail((current) =>
            current && current.text === next.text && current.truncated === next.truncated
              ? current
              : next,
          );
        }
      : null,
    live ? POLL_MS : null,
    [path, live],
  );
  return { tail, error };
};

export const AgentShellView = ({
  workspaceId,
  task,
  state,
}: {
  workspaceId: string;
  task: AgentTask;
  state: TaskState;
}) => {
  const { tail, error } = useOutput(task.outputPath, state === "running");
  const text = useMemo(() => cleanOutput(tail?.text ?? ""), [tail?.text]);
  const { scrollRef, contentRef, atBottom, onScroll, jumpToBottom } = useStickToBottom(text);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1.5 text-[11.5px]">
        <span className="font-medium text-fg">{STATE_LABEL[state]}</span>
        {task.startedAt && (
          <span className="text-faint">
            started <TimeAgo ms={Date.parse(task.startedAt)} />
          </span>
        )}
        {task.summary && <span className="min-w-0 truncate text-faint">{task.summary}</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void copyText(task.command, "Command copied")}
          >
            <Copy /> Copy command
          </Button>
          {task.outputPath && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => useWorkspaceStore.getState().openFile(workspaceId, task.outputPath!)}
            >
              <FileText /> Open output
            </Button>
          )}
        </div>
      </div>
      <p
        className="shrink-0 truncate border-b border-border px-3 py-1 font-mono text-[11px] text-muted"
        title={task.command}
      >
        {task.command}
      </p>
      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-auto">
          <div ref={contentRef} className="px-3 py-2">
            {!task.outputPath ? (
              <p className="text-xs text-faint">The agent didn't report an output file.</p>
            ) : error && !tail ? (
              <Alert tone="danger">{error}</Alert>
            ) : !tail ? (
              <LoadingState />
            ) : (
              <>
                {tail.truncated && (
                  <p className="mb-1 text-[11px] text-faint">Showing the end of the output.</p>
                )}
                <pre className="font-mono text-[12px] leading-[1.45] break-words whitespace-pre-wrap text-fg/90 select-text">
                  {text || "No output yet."}
                </pre>
              </>
            )}
          </div>
        </div>
        {!atBottom && (
          <Button
            size="xs"
            className="absolute right-4 bottom-3 shadow-lg shadow-shadow"
            onClick={jumpToBottom}
          >
            <ArrowDown /> Latest
          </Button>
        )}
      </div>
    </div>
  );
};
