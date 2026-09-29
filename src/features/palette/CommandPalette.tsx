import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/feedback";
import { Kbd } from "@/components/ui/kbd";
import { usePaletteItems, type PaletteItem } from "@/features/palette/usePaletteItems";
import { cn } from "@/lib/utils";
import { useUiStore, type PaletteMode } from "@/stores/ui-store";

const placeholders: Record<PaletteMode, string> = {
  all: "Search sessions, open tabs, files…   (type > for actions)",
  files: "Go to file…",
  commands: "Run an action…",
  chats: "Search inside every conversation…",
};

const PAGE_STEP = 8;

const PaletteList = ({
  mode,
  onClose,
  inputRef,
}: {
  mode: PaletteMode;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) => {
  const [query, setQuery] = useState(mode === "commands" ? ">" : "");
  const [selected, setSelected] = useState(0);
  const [enterQueued, setEnterQueued] = useState(false);
  const { items, loading, emptyHint } = usePaletteItems(mode, query);
  const listRef = useRef<HTMLDivElement>(null);
  const current = Math.min(selected, items.length - 1);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    requestAnimationFrame(item.run);
  };

  useEffect(() => {
    if (!enterQueued || loading) return;
    setEnterQueued(false);
    run(items[0]);
  });

  const move = (delta: number) =>
    setSelected((i) => Math.max(0, Math.min(items.length - 1, Math.max(0, i) + delta)));

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "PageDown") move(PAGE_STEP);
    else if (event.key === "PageUp") move(-PAGE_STEP);
    else if (event.key === "Enter") {
      if (items[current]) run(items[current]);
      else if (loading) setEnterQueued(true);
    } else return;
    event.preventDefault();
  };

  return (
    <>
      <div className="flex h-12 items-center gap-3 border-b border-border px-4">
        <Search className="size-4 shrink-0 text-faint" />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={current >= 0 ? `palette-item-${current}` : undefined}
          aria-label="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholders[mode]}
          className="h-full flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-faint"
        />
        {loading && <Spinner className="size-3.5" />}
      </div>
      <div
        ref={listRef}
        id="palette-results"
        role="listbox"
        aria-label="Results"
        className="max-h-[min(460px,60vh)] overflow-y-auto p-1.5"
      >
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-faint">{emptyHint}</p>
        ) : (
          items.map((item, index) => (
            <div key={item.id} role="presentation">
              {(index === 0 || items[index - 1].group !== item.group) && (
                <div
                  role="presentation"
                  className="truncate px-2.5 pt-2 pb-1 text-[10.5px] font-semibold tracking-wider text-faint uppercase"
                >
                  {item.group}
                </div>
              )}
              <div
                role="option"
                id={`palette-item-${index}`}
                aria-selected={index === current}
                data-index={index}
                onMouseMove={() => index !== current && setSelected(index)}
                onClick={() => run(item)}
                className={cn(
                  "flex h-9 w-full cursor-default items-center gap-2.5 rounded-md px-2.5 text-left [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted",
                  index === current && "bg-accent-soft",
                )}
              >
                {item.icon}
                <span
                  className={cn(
                    "min-w-0 truncate text-[13px] text-fg",
                    mode === "chats" ? "flex-1" : "max-w-[65%] shrink-0",
                  )}
                >
                  {item.title}
                </span>
                <span
                  className={cn(
                    "min-w-0 truncate text-[11.5px] text-faint",
                    mode === "chats" ? "max-w-[40%] shrink-0" : "flex-1",
                  )}
                >
                  {item.subtitle}
                </span>
                {item.hint && <Kbd keys={item.hint} className="shrink-0" />}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="flex h-8 items-center gap-4 border-t border-border px-4 text-[11px] text-faint">
        <span className="flex items-center gap-1.5">
          <Kbd keys="↑ ↓" /> navigate
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd keys="Enter" /> open
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd keys="Esc" /> close
        </span>
      </div>
    </>
  );
};

export const CommandPalette = () => {
  const mode = useUiStore((s) => s.paletteMode);
  const closePalette = useUiStore((s) => s.closePalette);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      open={!!mode}
      onOpenChange={(open) => !open && closePalette()}
      title="Command palette"
      description="Search sessions, files and actions"
      hideHeader
      initialFocusRef={inputRef}
      className="top-[11%] w-[min(680px,calc(100vw-48px))] overflow-hidden"
    >
      {mode && <PaletteList key={mode} mode={mode} onClose={closePalette} inputRef={inputRef} />}
    </Dialog>
  );
};
