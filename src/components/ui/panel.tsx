import { AlertTriangle, ChevronRight, Info, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

export const PanelHeader = ({ title, children }: { title: string; children?: React.ReactNode }) => (
  <div className="flex h-10 shrink-0 items-center justify-between pr-2 pl-3.5">
    <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</span>
    <div className="flex items-center gap-0.5">{children}</div>
  </div>
);

export const SectionLabel = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <p className={cn("text-[10.5px] font-semibold tracking-wider text-faint uppercase", className)}>
    {children}
  </p>
);

export const Chevron = ({ open, className }: { open: boolean; className?: string }) => (
  <ChevronRight
    className={cn(
      "size-3 shrink-0 transition-transform duration-100",
      open && "rotate-90",
      className,
    )}
  />
);

type AlertTone = "danger" | "warning" | "info";

const alertTone: Record<AlertTone, string> = {
  danger: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
  info: "border-info/30 bg-info/10 text-info",
};

export const Alert = ({
  tone,
  children,
  action,
  className,
}: {
  tone: AlertTone;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) => {
  const Icon = tone === "info" ? Info : AlertTriangle;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed",
        alertTone[tone],
        className,
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
    </div>
  );
};

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

export const SearchInput = ({
  value,
  onChange,
  className,
  inputRef,
  onKeyDown,
  ...props
}: SearchInputProps) => (
  <div
    className={cn(
      "flex h-7 items-center gap-2 rounded-md border border-border bg-bg px-2 focus-within:border-border-strong",
      className,
    )}
  >
    <Search className="size-3.5 shrink-0 text-faint" />
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && value) {
          e.stopPropagation();
          onChange("");
        }
        onKeyDown?.(e);
      }}
      className="h-full min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-faint"
      {...props}
    />
    {value && (
      <button
        type="button"
        aria-label="Clear search"
        onClick={() => onChange("")}
        className="text-faint hover:text-fg"
      >
        <X className="size-3.5" />
      </button>
    )}
  </div>
);

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
}

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: SegmentedProps<T>) => (
  <div role="group" className="inline-flex rounded-md border border-border-strong bg-bg p-0.5">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}
        className={cn(
          "flex items-center gap-1 rounded [&_svg]:size-3",
          size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-7 px-3 text-xs",
          value === option.value ? "bg-active text-fg" : "text-faint hover:text-fg",
        )}
      >
        {option.icon}
        {option.label}
      </button>
    ))}
  </div>
);
