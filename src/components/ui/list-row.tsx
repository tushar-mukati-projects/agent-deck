import { cn } from "@/lib/utils";

interface ListRowProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  meta?: React.ReactNode;
  onClick: () => void;
  actions?: React.ReactNode;
  selected?: boolean;
  dim?: boolean;
  mono?: boolean;
  disabled?: boolean;
}

export const ListRow = ({
  icon,
  title,
  subtitle,
  badge,
  meta,
  onClick,
  actions,
  selected,
  dim,
  mono,
  disabled,
}: ListRowProps) => (
  <div
    className={cn(
      "group flex items-start gap-2 rounded-md px-2 py-1",
      selected ? "bg-active" : !disabled && "hover:bg-hover",
      dim && "opacity-55",
    )}
  >
    <span className="mt-[3px] flex shrink-0 text-faint [&_svg]:size-3.5">{icon}</span>
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={subtitle ?? title}
      aria-current={selected || undefined}
      className="min-w-0 flex-1 text-left disabled:cursor-default"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "min-w-0 truncate text-[12px] text-fg/90",
            mono && "font-mono text-[11.5px]",
          )}
        >
          {title}
        </span>
        {badge}
        {meta && (
          <span className="ml-auto shrink-0 text-[10.5px] text-faint tabular-nums">{meta}</span>
        )}
      </div>
      {subtitle && (
        <p className="line-clamp-2 text-[10.5px] leading-snug break-words text-faint">{subtitle}</p>
      )}
    </button>
    {actions && (
      <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        {actions}
      </div>
    )}
  </div>
);
