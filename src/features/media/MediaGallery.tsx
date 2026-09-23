import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AtSign,
  Copy,
  Film,
  FolderOpen,
  Image as ImageIcon,
  Layers,
  Music,
  RefreshCw,
} from "lucide-react";

import { canMention, mentionInClaude } from "@/actions/files";

import { EmptyState, Spinner } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/menu";
import { api } from "@/lib/tauri/commands";
import { assetUrl, copyText, revealInExplorer } from "@/lib/tauri/system";
import { SearchInput } from "@/components/ui/panel";
import { DECK_PATH_MIME } from "@/lib/terminal/input";
import {
  basename,
  cn,
  dirname,
  errorMessage,
  formatBytes,
  relativePath,
  timeAgo,
} from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";
import type { MediaIndex, MediaItem, MediaKind, MediaSequence } from "@/types";

type Filter = "all" | MediaKind | "sequences";

const FILTERS: { value: Filter; label: string; icon: typeof Film }[] = [
  { value: "all", label: "All", icon: Layers },
  { value: "video", label: "Videos", icon: Film },
  { value: "image", label: "Images", icon: ImageIcon },
  { value: "audio", label: "Audio", icon: Music },
  { value: "sequences", label: "Frame folders", icon: Layers },
];

const PAGE = 120;

const useVisible = <T extends Element>() => {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setVisible(true),
      {
        rootMargin: "300px",
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return { ref, visible };
};

const Thumb = ({ item }: { item: MediaItem }) => {
  const { ref, visible } = useVisible<HTMLDivElement>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const src = visible ? assetUrl(item.path) : undefined;
  return (
    <div ref={ref} className="relative aspect-video overflow-hidden rounded-md bg-panel">
      {item.kind === "video" && src && (
        <video
          ref={videoRef}
          src={`${src}#t=0.5`}
          preload="metadata"
          muted
          loop
          playsInline
          onMouseEnter={() => void videoRef.current?.play().catch(() => undefined)}
          onMouseLeave={() => videoRef.current?.pause()}
          className="h-full w-full object-cover"
        />
      )}
      {item.kind === "image" && src && (
        <img src={src} alt="" loading="lazy" className="h-full w-full object-contain" />
      )}
      {item.kind === "audio" && (
        <div className="flex h-full items-center justify-center text-faint">
          <Music className="size-7" strokeWidth={1.5} />
        </div>
      )}
      {item.kind === "video" && (
        <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/60 px-1 py-px text-[10px] text-white">
          <Film className="size-2.5" /> video
        </span>
      )}
    </div>
  );
};

const ItemMenu = ({
  path,
  workspace,
  children,
}: {
  path: string;
  workspace: Workspace;
  children: React.ReactNode;
}) => {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          icon={<AtSign />}
          disabled={!canMention(workspace)}
          onSelect={() => mentionInClaude(workspace, path)}
        >
          Mention in Claude
        </ContextMenuItem>
        <ContextMenuItem icon={<FolderOpen />} onSelect={() => void revealInExplorer(path)}>
          Reveal in File Explorer
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem icon={<Copy />} onSelect={() => void copyText(path)}>
          Copy path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

const ItemCard = ({ item, workspace }: { item: MediaItem; workspace: Workspace }) => {
  const openFile = useWorkspaceStore((s) => s.openFile);
  return (
    <ItemMenu path={item.path} workspace={workspace}>
      <button
        type="button"
        onClick={() => openFile(workspace.id, item.path)}
        title={item.path}
        draggable
        onDragStart={(e) => e.dataTransfer.setData(DECK_PATH_MIME, item.path)}
        className="group flex flex-col gap-1.5 rounded-lg border border-border p-1.5 text-left transition-colors hover:border-border-strong hover:bg-hover/40"
      >
        <Thumb item={item} />
        <div className="min-w-0 px-0.5">
          <p className="truncate text-[11.5px] text-fg/90">{basename(item.path)}</p>
          <p className="truncate text-[10.5px] text-faint">
            {relativePath(dirname(item.path), workspace.cwd)} · {formatBytes(item.size)} ·{" "}
            {timeAgo(item.modifiedMs)}
          </p>
        </div>
      </button>
    </ItemMenu>
  );
};

const SequenceCard = ({
  sequence,
  workspace,
}: {
  sequence: MediaSequence;
  workspace: Workspace;
}) => {
  const openFile = useWorkspaceStore((s) => s.openFile);
  return (
    <ItemMenu path={sequence.dir} workspace={workspace}>
      <button
        type="button"
        onClick={() => openFile(workspace.id, sequence.sample)}
        title={sequence.dir}
        draggable
        onDragStart={(e) => e.dataTransfer.setData(DECK_PATH_MIME, sequence.dir)}
        className="group flex flex-col gap-1.5 rounded-lg border border-border p-1.5 text-left transition-colors hover:border-border-strong hover:bg-hover/40"
      >
        <div className="relative">
          <Thumb
            item={{
              path: sequence.sample,
              kind: "image",
              size: 0,
              modifiedMs: sequence.modifiedMs,
            }}
          />
          <span className="absolute top-1 right-1 rounded bg-black/60 px-1.5 py-px text-[10px] text-white">
            {sequence.count} frames
          </span>
        </div>
        <div className="min-w-0 px-0.5">
          <p className="truncate text-[11.5px] text-fg/90">{basename(sequence.dir)}</p>
          <p className="truncate text-[10.5px] text-faint">
            {relativePath(dirname(sequence.dir), workspace.cwd)}
          </p>
        </div>
      </button>
    </ItemMenu>
  );
};

export const MediaGallery = ({ root, workspace }: { root: string; workspace: Workspace }) => {
  const [index, setIndex] = useState<MediaIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setError(null);
    try {
      const result = await api.projectMedia(root);
      if (request === requestRef.current) setIndex(result);
    } catch (e) {
      if (request === requestRef.current) setError(errorMessage(e));
    }
  }, [root]);

  useEffect(() => {
    setIndex(null);
    void load();
  }, [load]);

  useEffect(() => setLimit(PAGE), [filter, query]);

  const counts = useMemo(() => {
    const items = index?.items ?? [];
    return {
      all: items.length,
      video: items.filter((i) => i.kind === "video").length,
      image: items.filter((i) => i.kind === "image").length,
      audio: items.filter((i) => i.kind === "audio").length,
      sequences: index?.sequences.length ?? 0,
    } satisfies Record<Filter, number>;
  }, [index]);

  const { items, sequences } = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (path: string) => terms.every((t) => path.toLowerCase().includes(t));
    return {
      items: (index?.items ?? []).filter(
        (i) => (filter === "all" || i.kind === filter) && matches(i.path),
      ),
      sequences: (index?.sequences ?? []).filter((s) => matches(s.dir)),
    };
  }, [index, filter, query]);
  const showSequences = filter === "sequences";
  const visibleCount = showSequences ? sequences.length : items.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-0.5 rounded-md border border-border p-0.5">
          {FILTERS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                "flex h-6 items-center gap-1.5 rounded px-2 text-[11.5px] whitespace-nowrap",
                filter === value ? "bg-active text-fg" : "text-faint hover:text-fg",
              )}
            >
              <Icon className="size-3" />
              {label}
              <span className="text-[10.5px] text-faint tabular-nums">{counts[value]}</span>
            </button>
          ))}
        </div>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Filter by name or folder…"
          className="ml-auto w-60"
        />
        <IconButton label="Rescan" onClick={() => void load()}>
          <RefreshCw />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-bg p-3">
        {error ? (
          <EmptyState
            className="h-full"
            icon={<ImageIcon />}
            title="Couldn't scan media"
            description={error}
          />
        ) : !index ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : visibleCount === 0 ? (
          <EmptyState
            className="h-full"
            icon={<ImageIcon />}
            title="No media here"
            description="Videos, images and audio in this folder will show up here."
          />
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5">
              {showSequences
                ? sequences
                    .slice(0, limit)
                    .map((s) => <SequenceCard key={s.dir} sequence={s} workspace={workspace} />)
                : items
                    .slice(0, limit)
                    .map((i) => <ItemCard key={i.path} item={i} workspace={workspace} />)}
            </div>
            {visibleCount > limit && (
              <div className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={() => setLimit((l) => l + PAGE * 2)}
                  className="h-7 rounded-md border border-border-strong bg-elevated px-3 text-xs text-fg hover:bg-hover"
                >
                  Show more ({visibleCount - limit} left)
                </button>
              </div>
            )}
            {index.truncated && (
              <p className="pt-2 text-center text-[11px] text-faint">
                Showing the newest {index.items.length} files.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};
