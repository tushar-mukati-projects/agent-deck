import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { mentionText } from "@/actions/files";
import { DECK_PATH_MIME } from "@/lib/terminal/input";
import {
  clearTerminalSearch,
  findInTerminal,
  fitTerminal,
  focusTerminal,
  mountTerminal,
  onFindRequest,
  pasteIntoTerminal,
  unmountTerminal,
} from "@/lib/terminal/registry";
import { cn } from "@/lib/utils";

interface TerminalViewProps {
  terminalId: string;
  dropRoot?: string;
}

const FindBar = ({ terminalId, onClose }: { terminalId: string; onClose: () => void }) => {
  const [query, setQuery] = useState("");
  const [missing, setMissing] = useState(false);

  const find = (direction: "next" | "previous") =>
    setMissing(!!query && !findInTerminal(terminalId, query, direction));

  const close = () => {
    clearTerminalSearch(terminalId);
    onClose();
    focusTerminal(terminalId);
  };

  return (
    <div className="animate-pop-in absolute top-2 right-4 z-10 flex items-center gap-1 rounded-lg border border-border-strong bg-overlay p-1 shadow-xl">
      <input
        autoFocus
        value={query}
        placeholder="Find in terminal"
        onChange={(e) => {
          setQuery(e.target.value);
          setMissing(!!e.target.value && !findInTerminal(terminalId, e.target.value, "next"));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") find(e.shiftKey ? "previous" : "next");
          if (e.key === "Escape") close();
        }}
        className={cn(
          "h-6 w-52 rounded bg-bg px-2 text-xs text-fg outline-none placeholder:text-faint",
          missing && "text-danger",
        )}
      />
      <button
        type="button"
        aria-label="Previous match"
        onClick={() => find("previous")}
        className="flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg"
      >
        <ChevronUp className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Next match"
        onClick={() => find("next")}
        className="flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg"
      >
        <ChevronDown className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Close find"
        onClick={close}
        className="flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
};

export const TerminalView = ({ terminalId, dropRoot }: TerminalViewProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [finding, setFinding] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    mountTerminal(terminalId, host);
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitTerminal(terminalId));
    });
    observer.observe(host);
    const stopFind = onFindRequest((id) => id === terminalId && setFinding(true));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      stopFind();
      unmountTerminal(terminalId, host);
    };
  }, [terminalId]);

  const acceptsDrop = (event: React.DragEvent) =>
    !!dropRoot && event.dataTransfer.types.includes(DECK_PATH_MIME);

  const handleDrop = (event: React.DragEvent) => {
    setDragging(false);
    const path = event.dataTransfer.getData(DECK_PATH_MIME);
    if (!path || !dropRoot) return;
    event.preventDefault();
    pasteIntoTerminal(terminalId, mentionText(path, dropRoot));
  };

  return (
    <div className="relative h-full w-full">
      <div
        ref={hostRef}
        style={{ backgroundColor: "var(--color-terminal-bg)" }}
        className="h-full w-full overflow-hidden"
        onMouseDown={() => requestAnimationFrame(() => focusTerminal(terminalId))}
        onDragOver={(e) => {
          if (!acceptsDrop(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      />
      {dragging && (
        <div className="pointer-events-none absolute inset-1 flex items-center justify-center rounded-lg border-2 border-dashed border-accent/60 bg-accent/5 text-xs font-medium text-accent">
          Drop to mention in this session
        </div>
      )}
      {finding && <FindBar terminalId={terminalId} onClose={() => setFinding(false)} />}
    </div>
  );
};
