import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type IconButtonProps = React.ComponentProps<"button"> & {
  label: string;
  shortcut?: string;
  active?: boolean;
};

export const IconButton = ({
  label,
  shortcut,
  active,
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
        className,
      )}
      {...props}
    >
      {children}
    </button>
  </Tooltip>
);
