import { useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { cn } from "@/lib/utils";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  className?: string;
  hideHeader?: boolean;
  children: React.ReactNode;
}

export const Dialog = ({
  open,
  onOpenChange,
  title,
  description,
  className,
  hideHeader,
  children,
}: DialogProps) => {
  // Dialogs are opened from the store, not a trigger, so remember what had focus (often a terminal) and return to it.
  const previousFocus = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-fade-in fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]" />
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
          className={cn(
            "animate-pop-in fixed top-[13%] left-1/2 z-50 w-[min(560px,calc(100vw-48px))] -translate-x-1/2 rounded-xl border border-border-strong bg-panel shadow-2xl shadow-black/60 outline-none",
            className,
          )}
        >
          <DialogPrimitive.Title
            className={cn(hideHeader ? "sr-only" : "px-5 pt-4 text-[15px] font-semibold")}
          >
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            className={cn(
              hideHeader || !description
                ? "sr-only"
                : "px-5 pt-1 text-[12.5px] leading-relaxed text-muted",
            )}
          >
            {description ?? title}
          </DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
