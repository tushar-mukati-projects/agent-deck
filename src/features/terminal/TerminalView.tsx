import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { protectedTerminalId } from "@/lib/desktopAgent";
import { DECK_PATH_MIME } from "@/lib/terminal/input";
import {
  clearTerminalSearch,
  findInTerminal,
  fitTerminal,
  mountTerminal,
  onFindRequest,
  pasteIntoTerminal,
  requestFocus,
  unmountTerminal,
} from "@/lib/terminal/registry";
import { cn } from "@/lib/utils";

interface TerminalViewProps {
  terminalId: string;
  dropText: (path: string) => string;
  dropLabel?: string;
}

const findButtonClass =
  "flex size-6 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg";

const FindBar = ({
  terminalId,
  request,
  onClose,
}: {
  terminalId: string;
  request: number;
  onClose: () => void;
}) => {
  const [query, setQuery] = useState("");
  const [missing, setMissing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [request]);

  useEffect(() => () => clearTerminalSearch(terminalId), [terminalId]);

  const find = (direction: "next" | "previous", text = query) =>
    setMissing(!!text && !findInTerminal(terminalId, text, direction));

  const close = () => {
    clearTerminalSearch(terminalId);
    onClose();
    requestFocus(terminalId);
  };

  return (
    <div className="animate-pop-in absolute top-2 right-4 z-10 flex items-center gap-1 rounded-lg border border-border-strong bg-overlay p-1 shadow-xl shadow-shadow">
      <input
        ref={inputRef}
        aria-label="Find in terminal"
        value={query}
        placeholder="Find in terminal"
        onChange={(e) => {
          setQuery(e.target.value);
          find("next", e.target.value);
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
        className={findButtonClass}
      >
        <ChevronUp className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label="Next match"
        onClick={() => find("next")}
        className={findButtonClass}
      >
        <ChevronDown className="size-3.5" />
      </button>
      <button type="button" aria-label="Close find" onClick={close} className={findButtonClass}>
        <X className="size-3.5" />
      </button>
    </div>
  );
};

export const TerminalView = ({ terminalId, dropText, dropLabel }: TerminalViewProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const [findRequest, setFindRequest] = useState(0);
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
    const stopFind = onFindRequest((id) => id === terminalId && setFindRequest((n) => n + 1));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      stopFind();
      unmountTerminal(terminalId, host);
    };
  }, [terminalId]);

  const acceptsDrop = (event: React.DragEvent) => event.dataTransfer.types.includes(DECK_PATH_MIME);

  const handleDrop = (event: React.DragEvent) => {
    setDragging(false);
    const path = event.dataTransfer.getData(DECK_PATH_MIME);
    if (!path) return;
    event.preventDefault();
    pasteIntoTerminal(terminalId, dropText(path));
  };

  return (
    <div
      id={protectedTerminalId(terminalId)}
      role="region"
      aria-label="Session terminal"
      className="relative h-full w-full"
    >
      <div
        ref={hostRef}
        style={{ backgroundColor: "var(--color-terminal-bg)" }}
        className="isolate h-full w-full overflow-hidden"
        onMouseDown={() => requestAnimationFrame(() => requestFocus(terminalId))}
        onDragOver={(e) => {
          if (!acceptsDrop(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={handleDrop}
      />
      {dragging && (
        <div className="pointer-events-none absolute inset-1 flex items-center justify-center rounded-lg border-2 border-dashed border-accent/60 bg-accent/5 text-xs font-medium text-accent">
          {dropLabel ?? "Drop to insert the path"}
        </div>
      )}
      {findRequest > 0 && (
        <FindBar terminalId={terminalId} request={findRequest} onClose={() => setFindRequest(0)} />
      )}
    </div>
  );
};
