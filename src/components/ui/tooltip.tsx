import * as TooltipPrimitive from "@radix-ui/react-tooltip";

interface TooltipProps {
  content: React.ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactNode;
}

export const TooltipProvider = ({ children }: { children: React.ReactNode }) => (
  <TooltipPrimitive.Provider delayDuration={450} skipDelayDuration={150}>
    {children}
  </TooltipPrimitive.Provider>
);

export const Tooltip = ({ content, shortcut, side = "bottom", children }: TooltipProps) => (
  <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        side={side}
        sideOffset={6}
        className="animate-fade-in z-50 flex max-w-[420px] items-center gap-2 rounded-md border border-border-strong bg-overlay px-2 py-1 text-xs text-fg shadow-xl shadow-black/40"
      >
        {content}
        {shortcut && <span className="font-mono text-[10.5px] text-faint">{shortcut}</span>}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
);
