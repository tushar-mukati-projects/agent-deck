import { useEffect, useRef } from "react";

import { fitTerminal, focusTerminal, mountTerminal, unmountTerminal } from "@/lib/terminal/registry";
import { cn } from "@/lib/utils";

interface TerminalViewProps {
  terminalId: string;
  autoFocus?: boolean;
  className?: string;
}

export const TerminalView = ({ terminalId, autoFocus, className }: TerminalViewProps) => {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    mountTerminal(terminalId, host);
    if (autoFocus) focusTerminal(terminalId);

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fitTerminal(terminalId));
    });
    observer.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      unmountTerminal(terminalId, host);
    };
  }, [terminalId, autoFocus]);

  return (
    <div
      ref={hostRef}
      style={{ backgroundColor: "var(--color-terminal-bg)" }}
      className={cn("h-full w-full overflow-hidden", className)}
      onMouseDown={() => requestAnimationFrame(() => focusTerminal(terminalId))}
    />
  );
};
