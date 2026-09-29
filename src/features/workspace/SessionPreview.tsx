import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Calendar,
  FolderOpen,
  GitBranch,
  GitFork,
  MessageSquare,
  Pencil,
  Play,
  SquareTerminal,
  Trash2,
  Wrench,
} from "lucide-react";
import { format } from "date-fns";

import { deleteSessionWithConfirm, renameSession, resumeWorkspace } from "@/actions/sessions";
import { Button } from "@/components/ui/button";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Alert, SearchInput } from "@/components/ui/panel";
import { MarkdownView } from "@/features/viewer/MarkdownView";
import { useExternalLive } from "@/hooks/useWorkspaceStatus";
import { api } from "@/lib/tauri/commands";
import { revealInExplorer } from "@/lib/tauri/system";
import { errorMessage, formatBytes, shortenHome } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { TranscriptItem, Workspace } from "@/types";

const PAGE = 60;
const CACHE_LIMIT = 24;
const NEAR_BOTTOM_PX = 120;

const cache = new Map<string, { stamp: number; items: TranscriptItem[] }>();

const remember = (filePath: string, stamp: number, items: TranscriptItem[]) => {
  cache.delete(filePath);
  cache.set(filePath, { stamp, items });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
};

const useTranscript = (filePath: string | null, distro: string | null, stamp: number) => {
  const initial = filePath ? cache.get(filePath) : undefined;
  const [items, setItems] = useState<TranscriptItem[] | null>(initial?.items ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!filePath) {
      setItems([]);
      return;
    }
    const cached = cache.get(filePath);
    if (cached) setItems(cached.items);
    if (cached?.stamp === stamp) return;
    let cancelled = false;
    api
      .sessionTranscript(filePath, distro)
      .then((result) => {
        remember(filePath, stamp, result);
        if (!cancelled) {
          setItems(result);
          setError(null);
        }
      })
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [filePath, distro, stamp]);

  return { items, error };
};

const useFolderExists = (cwd: string) => {
  const [exists, setExists] = useState(true);
  useEffect(() => {
    let cancelled = false;
    api
      .pathIsDir(cwd)
      .then((value) => !cancelled && setExists(value))
      .catch(() => !cancelled && setExists(false));
    return () => {
      cancelled = true;
    };
  }, [cwd]);
  return exists;
};

const Message = ({ item }: { item: TranscriptItem }) => {
  if (item.kind === "tool") {
    return (
      <div className="ml-0.5 flex items-center gap-2 py-px pl-1 font-mono text-[10.5px] text-faint/80">
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

const Meta = ({ workspace }: { workspace: Workspace }) => {
  const session = useSessionsStore((s) => s.byId[workspace.sessionId]);
  const home = useSessionsStore((s) => s.environment?.home ?? "");
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-faint [&_svg]:size-3">
      <span className="flex items-center gap-1.5" title={workspace.cwd}>
        <FolderOpen />
        {shortenHome(workspace.cwd, home)}
      </span>
      {session?.gitBranch && session.gitBranch !== "HEAD" && (
        <span className="flex items-center gap-1.5">
          <GitBranch />
          {session.gitBranch}
        </span>
      )}
      {session?.startedAt && (
        <span className="flex items-center gap-1.5">
          <Calendar />
          {format(new Date(session.startedAt), "d MMM yyyy, HH:mm")}
        </span>
      )}
      {session && (
        <span className="flex items-center gap-1.5">
          <MessageSquare />
          {session.promptCount} {session.promptCount === 1 ? "prompt" : "prompts"} ·{" "}
          {formatBytes(session.size)}
        </span>
      )}
      {session?.version && <span>v{session.version}</span>}
    </div>
  );
};

export const SessionPreview = ({ workspace }: { workspace: Workspace }) => {
  const session = useSessionsStore((s) => s.byId[workspace.sessionId]);
  const external = useExternalLive(workspace.sessionId);
  const folderExists = useFolderExists(workspace.cwd);
  const { items, error } = useTranscript(
    session?.filePath ?? null,
    session?.distro ?? null,
    session?.modifiedMs ?? 0,
  );
  const [visible, setVisible] = useState(PAGE);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const [atBottom, setAtBottom] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const stickRef = useRef(true);
  const anchorRef = useRef<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    resumeRef.current?.focus({ preventScroll: true });
  }, [workspace.id]);

  const matches = useMemo(() => {
    if (!items) return [];
    const indexed = items.map((item, index) => ({ item, index }));
    return deferredQuery
      ? indexed.filter(({ item }) => item.text.toLowerCase().includes(deferredQuery))
      : indexed;
  }, [items, deferredQuery]);

  const shown = deferredQuery ? matches : matches.slice(Math.max(0, matches.length - visible));
  const hiddenCount = matches.length - shown.length;

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (anchorRef.current !== null) {
      element.scrollTop = element.scrollHeight - anchorRef.current;
      anchorRef.current = null;
    } else if (stickRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [shown.length, items]);

  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element || !content) return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current && anchorRef.current === null) element.scrollTop = element.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const near = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    stickRef.current = near;
    setAtBottom(near);
  };

  const showEarlier = () => {
    const element = scrollRef.current;
    if (element) anchorRef.current = element.scrollHeight - element.scrollTop;
    setVisible((v) => v + PAGE * 2);
  };

  const jumpToLatest = () => {
    const element = scrollRef.current;
    if (!element) return;
    stickRef.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="shrink-0 border-b border-border px-6 pt-4 pb-3.5">
        <div className="group flex items-start gap-1">
          <h1
            title="Double-click to rename"
            onDoubleClick={() => session && renameSession(session)}
            className="line-clamp-2 min-w-0 cursor-text text-[15px] font-semibold tracking-tight text-fg"
          >
            {workspace.title}
          </h1>
          {session && (
            <IconButton
              label="Rename"
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => renameSession(session)}
            >
              <Pencil />
            </IconButton>
          )}
        </div>
        <Meta workspace={workspace} />

        {!folderExists && (
          <Alert tone="danger" className="mt-3">
            This folder isn't reachable from this machine. It may be on another host, in a stopped
            WSL distro, or it was moved, so the session can't be resumed here.
          </Alert>
        )}
        {external && (
          <Alert tone="warning" className="mt-3">
            This session is already open in another terminal (PID {external.pid}). Resuming it here
            too makes both copies write to the same conversation. Fork it instead for a separate
            branch.
          </Alert>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button
            ref={resumeRef}
            variant="primary"
            size="sm"
            disabled={!folderExists}
            onClick={() => void resumeWorkspace(workspace.id)}
          >
            <Play className="fill-current" /> {session ? "Resume session" : "Start session"}
            <Kbd
              keys="Enter"
              className="ml-0.5 opacity-60 [&_kbd]:border-on-accent/25 [&_kbd]:bg-on-accent/10 [&_kbd]:text-on-accent"
            />
          </Button>
          {session && (
            <Button
              size="sm"
              disabled={!folderExists}
              onClick={() => void resumeWorkspace(workspace.id, { fork: true })}
            >
              <GitFork /> Fork
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={!folderExists}
            onClick={() => useWorkspaceStore.getState().openShell(workspace.id)}
          >
            <SquareTerminal /> Shell
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!folderExists}
            onClick={() => void revealInExplorer(workspace.cwd)}
          >
            <FolderOpen /> Folder
          </Button>
          <div className="ml-auto flex items-center gap-1.5">
            {items && items.length > 0 && (
              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Find in conversation"
                className="w-[200px]"
              />
            )}
            {session && (
              <Button
                size="sm"
                variant="ghost"
                className="hover:bg-danger/15 hover:text-danger"
                onClick={() => void deleteSessionWithConfirm(session)}
              >
                <Trash2 /> Delete
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
          <div ref={contentRef} className="mx-auto max-w-[860px] px-6 py-4">
            {error && !items?.length ? (
              <EmptyState
                icon={<AlertTriangle />}
                title="Couldn't read this conversation"
                description={error}
              />
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
            ) : deferredQuery && matches.length === 0 ? (
              <EmptyState
                icon={<MessageSquare />}
                title="No matches"
                description={`Nothing in this conversation mentions “${query.trim()}”.`}
              />
            ) : (
              <>
                {deferredQuery && (
                  <p className="mb-3 text-center text-[11px] text-faint">
                    {matches.length} {matches.length === 1 ? "message matches" : "messages match"}
                  </p>
                )}
                {hiddenCount > 0 && (
                  <div className="mb-4 flex justify-center">
                    <Button size="sm" variant="ghost" onClick={showEarlier}>
                      Show {Math.min(hiddenCount, PAGE * 2)} earlier messages
                    </Button>
                  </div>
                )}
                {shown.map(({ item, index }) => (
                  <Message key={index} item={item} />
                ))}
              </>
            )}
          </div>
        </div>
        {!atBottom && !deferredQuery && (
          <Button
            size="sm"
            className="absolute right-5 bottom-4 shadow-lg shadow-shadow"
            onClick={jumpToLatest}
          >
            <ArrowDown /> Latest
          </Button>
        )}
      </div>
    </div>
  );
};
