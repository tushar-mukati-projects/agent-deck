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
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

export const Dialog = ({
  open,
  onOpenChange,
  title,
  description,
  className,
  hideHeader,
  initialFocusRef,
  children,
}: DialogProps) => {
  const previousFocus = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="animate-fade-in fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(event) => {
            previousFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            const initial = initialFocusRef?.current;
            if (!initial) return;
            event.preventDefault();
            initial.focus({ preventScroll: true });
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
            "animate-pop-in fixed top-[13%] left-1/2 z-50 w-[min(560px,calc(100vw-48px))] -translate-x-1/2 rounded-xl border border-border-strong bg-panel shadow-2xl shadow-shadow outline-none",
            className,
          )}
        >
          <DialogPrimitive.Title
            className={hideHeader ? "sr-only" : "px-5 pt-4 text-[15px] font-semibold"}
          >
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description
            className={
              hideHeader || !description
                ? "sr-only"
                : "px-5 pt-1 text-[12.5px] leading-relaxed text-muted"
            }
          >
            {description ?? title}
          </DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
