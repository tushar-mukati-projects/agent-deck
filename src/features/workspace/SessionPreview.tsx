import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Calendar,
  FolderOpen,
  GitBranch,
  GitFork,
  MessageSquare,
  Play,
  SquareTerminal,
  Trash2,
  Wrench,
} from "lucide-react";
import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { Kbd } from "@/components/ui/kbd";
import { MarkdownView } from "@/features/viewer/MarkdownView";
import { deleteSessionWithConfirm } from "@/hooks/useDeleteSession";
import { resumeWorkspace } from "@/hooks/useResumeSession";
import { useExternalLive } from "@/hooks/useWorkspaceStatus";
import { api } from "@/lib/tauri/commands";
import { revealInExplorer } from "@/lib/tauri/system";
import { cn, errorMessage, formatBytes, shortenHome } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useUiStore } from "@/stores/ui-store";
import { useWorkspaceStore, type WorkspaceRecord } from "@/stores/workspace-store";
import type { TranscriptItem } from "@/types";

const PAGE = 60;
const cache = new Map<string, TranscriptItem[]>();

const useTranscript = (filePath: string | null, distro: string | null, stamp: number) => {
  const cacheKey = `${filePath}:${stamp}`;
  const [items, setItems] = useState<TranscriptItem[] | null>(() => cache.get(cacheKey) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) {
      setItems([]);
      return;
    }
    const cached = cache.get(cacheKey);
    if (cached) {
      setItems(cached);
      return;
    }
    let cancelled = false;
    api
      .sessionTranscript(filePath, distro)
      .then((result) => {
        cache.set(cacheKey, result);
        if (!cancelled) setItems(result);
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [filePath, distro, cacheKey]);

  return { items, error };
};

const useFolderExists = (cwd: string) => {
  const [exists, setExists] = useState(true);
  useEffect(() => {
    void api.pathIsDir(cwd).then(setExists);
  }, [cwd]);
  return exists;
};

const Message = ({ item }: { item: TranscriptItem }) => {
  if (item.kind === "tool") {
    return (
      <div className="flex items-center gap-2 py-px pl-1 font-mono text-[10.5px] text-faint/80">
        <Wrench className="size-3 shrink-0" />
        <span className="truncate">{item.text}</span>
      </div>
    );
  }
  if (item.role === "user") {
    return (
      <div className="my-2.5 flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm border border-accent/15 bg-accent/[0.08] px-3 py-1.5 text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg/90 select-text">
          {item.text}
        </div>
      </div>
    );
  }
  return (
    <div className="my-2">
      <MarkdownView source={item.text} compact />
    </div>
  );
};

export const SessionPreview = ({ workspace }: { workspace: WorkspaceRecord }) => {
  const session = useSessionsStore((s) => s.byId[workspace.sessionId]);
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  const { resume, openShell } = useWorkspaceStore.getState();
  const external = useExternalLive(workspace.sessionId);
  const folderExists = useFolderExists(workspace.cwd);
  const { items, error } = useTranscript(session?.filePath ?? null, session?.distro ?? null, session?.modifiedMs ?? 0);
  const [visible, setVisible] = useState(PAGE);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    resumeRef.current?.focus();
  }, [workspace.id]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element && items) element.scrollTop = element.scrollHeight;
  }, [items]);

  const shown = items ? items.slice(Math.max(0, items.length - visible)) : [];
  const hiddenCount = items ? Math.max(0, items.length - visible) : 0;
  const canResume = folderExists;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="shrink-0 border-b border-border px-6 pt-4 pb-3.5">
        <h1
          title="Double-click to rename"
          onDoubleClick={() => session && useUiStore.getState().setRenameTarget(session)}
          className="line-clamp-2 cursor-text text-[15px] font-semibold tracking-tight text-fg"
        >{workspace.title}</h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-faint [&_svg]:!size-3">
          <span className="flex items-center gap-1.5" title={workspace.cwd}>
            <FolderOpen className="size-3.5" />
            {shortenHome(workspace.cwd, home)}
          </span>
          {session?.gitBranch && session.gitBranch !== "HEAD" && (
            <span className="flex items-center gap-1.5">
              <GitBranch className="size-3.5" />
              {session.gitBranch}
            </span>
          )}
          {session?.startedAt && (
            <span className="flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              {format(new Date(session.startedAt), "d MMM yyyy, HH:mm")}
            </span>
          )}
          {session && (
            <span className="flex items-center gap-1.5">
              <MessageSquare className="size-3.5" />
              {session.promptCount} {session.promptCount === 1 ? "prompt" : "prompts"} · {formatBytes(session.size)}
            </span>
          )}
          {session?.version && <span>v{session.version}</span>}
        </div>

        {!folderExists && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            This folder isn't reachable from this machine (it may be from a remote host, a stopped WSL distro, or it was moved), so the session can't be resumed here.
          </div>
        )}
        {external && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
            This session is already open in another terminal (PID {external.pid}). Resuming it here too can make both copies write to the same conversation — fork it instead if you want a separate branch.
          </div>
        )}

        <div className="mt-3 flex items-center gap-1.5">
          <Button
            ref={resumeRef}
            variant="primary"
            size="sm"
            disabled={!canResume}
            onClick={() => void resumeWorkspace(workspace.id)}
          >
            <Play className="fill-current" /> {session ? "Resume session" : "Start session"}
            <Kbd keys="Enter" className="ml-0.5 opacity-60 [&_kbd]:border-on-accent/25 [&_kbd]:bg-on-accent/10 [&_kbd]:text-on-accent" />
          </Button>
          {session && (
            <Button size="sm" disabled={!canResume} onClick={() => resume(workspace.id, { fork: true })}>
              <GitFork /> Fork
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={!folderExists} onClick={() => openShell(workspace.id)}>
            <SquareTerminal /> Shell
          </Button>
          <Button size="sm" variant="ghost" disabled={!folderExists} onClick={() => void revealInExplorer(workspace.cwd)}>
            <FolderOpen /> Folder
          </Button>
          {session && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto hover:bg-danger/15 hover:text-danger"
              onClick={() => void deleteSessionWithConfirm(session)}
            >
              <Trash2 /> Delete
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[860px] px-6 py-4">
          {error ? (
            <EmptyState icon={<AlertTriangle />} title="Couldn't read this conversation" description={error} />
          ) : !items ? (
            <div className="flex justify-center py-10">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={<MessageSquare />}
              title="No messages yet"
              description="Start the session and your conversation will appear here."
            />
          ) : (
            <>
              {hiddenCount > 0 && (
                <div className="mb-4 flex justify-center">
                  <Button size="sm" variant="ghost" onClick={() => setVisible((v) => v + PAGE * 2)}>
                    Show {Math.min(hiddenCount, PAGE * 2)} earlier messages
                  </Button>
                </div>
              )}
              {shown.map((item, index) => (
                <div key={index} className={cn(item.kind === "tool" && "ml-0.5")}>
                  <Message item={item} />
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
