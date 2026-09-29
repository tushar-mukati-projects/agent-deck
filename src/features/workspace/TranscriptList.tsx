import { memo, useMemo, useState } from "react";
import { AlertTriangle, ArrowDown, MessageSquare, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/feedback";
import { useStickToBottom } from "@/features/workspace/useStickToBottom";
import { MarkdownView } from "@/features/viewer/MarkdownView";
import type { TranscriptItem } from "@/types";

const PAGE = 60;

const Message = memo(
  ({
    item,
    baseDir,
    onOpenPath,
  }: {
    item: TranscriptItem;
    baseDir: string;
    onOpenPath: (path: string) => void;
  }) => {
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
          <div className="max-w-[85%] rounded-lg rounded-br-sm border border-accent/15 bg-accent/[0.08] px-3 py-1.5 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-fg/90 select-text">
            {item.text}
          </div>
        </div>
      );
    }
    return (
      <div className="my-2">
        <MarkdownView source={item.text} compact baseDir={baseDir} onOpenPath={onOpenPath} />
      </div>
    );
  },
);
Message.displayName = "Message";

interface TranscriptListProps {
  items: TranscriptItem[] | null;
  error: string | null;
  query: string;
  emptyDescription: string;
  baseDir: string;
  onOpenPath: (path: string) => void;
}

export const TranscriptList = ({
  items,
  error,
  query,
  emptyDescription,
  baseDir,
  onOpenPath,
}: TranscriptListProps) => {
  const [page, setPage] = useState({ query, visible: PAGE });
  const visible = page.query === query ? page.visible : PAGE;
  const matches = useMemo(() => {
    const indexed = (items ?? []).map((item, index) => ({ item, index }));
    return query ? indexed.filter(({ item }) => item.text.toLowerCase().includes(query)) : indexed;
  }, [items, query]);
  const shown = matches.slice(Math.max(0, matches.length - visible));
  const hiddenCount = matches.length - shown.length;
  const { scrollRef, contentRef, atBottom, onScroll, keepPosition, jumpToBottom } =
    useStickToBottom(`${shown.length}:${items?.length ?? -1}:${query}`);

  const showEarlier = () => {
    keepPosition();
    setPage({ query, visible: visible + PAGE * 2 });
  };

  const body = () => {
    if (error && !items?.length)
      return (
        <EmptyState
          icon={<AlertTriangle />}
          title="Couldn't read this conversation"
          description={error}
        />
      );
    if (!items) return <LoadingState />;
    if (items.length === 0)
      return (
        <EmptyState
          icon={<MessageSquare />}
          title="No messages yet"
          description={emptyDescription}
        />
      );
    if (query && matches.length === 0)
      return (
        <EmptyState
          icon={<MessageSquare />}
          title="No matches"
          description={`Nothing in this conversation mentions “${query}”.`}
        />
      );
    return (
      <>
        {query && (
          <p className="mb-3 text-center text-[11px] text-faint">
            {matches.length} {matches.length === 1 ? "message matches" : "messages match"}
          </p>
        )}
        {hiddenCount > 0 && (
          <div className="mb-4 flex justify-center">
            <Button size="sm" variant="ghost" onClick={showEarlier}>
              Show {Math.min(hiddenCount, PAGE * 2)} earlier {query ? "matches" : "messages"}
            </Button>
          </div>
        )}
        {shown.map(({ item, index }) => (
          <Message key={index} item={item} baseDir={baseDir} onOpenPath={onOpenPath} />
        ))}
      </>
    );
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div ref={contentRef} className="mx-auto max-w-[860px] px-6 py-4">
          {body()}
        </div>
      </div>
      {!atBottom && (
        <Button
          size="sm"
          className="absolute right-5 bottom-4 shadow-lg shadow-shadow"
          onClick={jumpToBottom}
        >
          <ArrowDown /> Latest
        </Button>
      )}
    </div>
  );
};
