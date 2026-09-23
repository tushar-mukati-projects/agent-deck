import { forwardRef } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: "sm" | "md";
  tooltipSide?: "top" | "bottom" | "left" | "right";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, shortcut, active, size = "sm", tooltipSide, className, children, ...props }, ref) => (
    <Tooltip content={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40",
          size === "sm" ? "size-6 [&_svg]:size-3.5" : "size-8 [&_svg]:size-4",
          active && "bg-hover text-fg",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  ),
);
IconButton.displayName = "IconButton";
