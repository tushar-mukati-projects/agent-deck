import { DANGER_HOVER } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type IconButtonProps = React.ComponentProps<"button"> & {
  label: string;
  shortcut?: string;
  active?: boolean;
  danger?: boolean;
};

export const IconButton = ({
  label,
  shortcut,
  active,
  danger,
  className,
  children,
  ...props
}: IconButtonProps) => (
  <Tooltip content={label} shortcut={shortcut}>
    <button
      type="button"
      aria-label={label}
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5",
        active && "bg-hover text-fg",
        danger && DANGER_HOVER,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  </Tooltip>
);
