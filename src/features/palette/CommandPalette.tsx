import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Search } from "lucide-react";

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

const PaletteList = ({ mode, onClose }: { mode: PaletteMode; onClose: () => void }) => {
  const [query, setQuery] = useState(mode === "commands" ? ">" : "");
  const [selected, setSelected] = useState(0);
  const { items, loading, emptyHint } = usePaletteItems(mode, query);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onClose();
    requestAnimationFrame(item.run);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") setSelected((i) => Math.min(items.length - 1, i + 1));
    else if (event.key === "ArrowUp") setSelected((i) => Math.max(0, i - 1));
    else if (event.key === "PageDown") setSelected((i) => Math.min(items.length - 1, i + 8));
    else if (event.key === "PageUp") setSelected((i) => Math.max(0, i - 8));
    else if (event.key === "Enter") run(items[selected]);
    else return;
    event.preventDefault();
  };

  return (
    <>
      <div className="flex h-12 items-center gap-3 border-b border-border px-4">
        <Search className="size-4 shrink-0 text-faint" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholders[mode]}
          className="h-full flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-faint"
        />
        {loading && <Spinner className="size-3.5" />}
      </div>
      <div ref={listRef} className="max-h-[min(460px,60vh)] overflow-y-auto p-1.5">
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-faint">{emptyHint}</p>
        ) : (
          items.map((item, index) => (
            <div key={item.id}>
              {(index === 0 || items[index - 1].group !== item.group) && (
                <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-semibold tracking-wider text-faint uppercase">
                  {item.group}
                </div>
              )}
              <button
                type="button"
                data-index={index}
                onMouseMove={() => setSelected(index)}
                onClick={() => run(item)}
                className={cn(
                  "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted",
                  index === selected ? "bg-accent-soft" : "",
                )}
              >
                {item.icon}
                <span
                  className={cn(
                    "truncate text-[13px] text-fg",
                    mode === "chats" ? "min-w-0 flex-1" : "shrink-0",
                  )}
                >
                  {item.title}
                </span>
                {item.subtitle && (
                  <span
                    className={cn(
                      "truncate text-[11.5px] text-faint",
                      mode === "chats" ? "max-w-[40%] shrink-0" : "min-w-0 flex-1",
                    )}
                  >
                    {item.subtitle}
                  </span>
                )}
                {!item.subtitle && <span className="flex-1" />}
                {item.hint && <Kbd keys={item.hint} />}
              </button>
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
  const previousFocus = useRef<HTMLElement | null>(null);

  return (
    <DialogPrimitive.Root open={!!mode} onOpenChange={(open) => !open && closePalette()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-fade-in fixed inset-0 z-40 bg-black/40" />
        <DialogPrimitive.Content
          onOpenAutoFocus={() => {
            previousFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(event) => {
            const target = previousFocus.current;
            previousFocus.current = null;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
          className="animate-pop-in fixed top-[11%] left-1/2 z-50 w-[min(680px,calc(100vw-48px))] -translate-x-1/2 overflow-hidden rounded-xl border border-border-strong bg-panel shadow-2xl shadow-black/60 outline-none"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search sessions, files and actions
          </DialogPrimitive.Description>
          {mode && <PaletteList key={mode} mode={mode} onClose={closePalette} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
