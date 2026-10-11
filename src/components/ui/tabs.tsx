import { forwardRef } from "react";
import { X } from "lucide-react";

import { useHorizontalWheel } from "@/hooks/useHorizontalWheel";
import { cn } from "@/lib/utils";

const NAV_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

const moveBetweenTabs = (event: React.KeyboardEvent<HTMLElement>) => {
  if (!NAV_KEYS.has(event.key) || !event.currentTarget.contains(event.target as Node)) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
  const index = tabs.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  const last = tabs.length - 1;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? last
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next].focus();
};

interface TabStripProps {
  label: string;
  className?: string;
  children: React.ReactNode;
}

export const TabStrip = ({ label, className, children }: TabStripProps) => {
  const ref = useHorizontalWheel<HTMLDivElement>();
  return (
    <div
      ref={ref}
      role="tablist"
      aria-label={label}
      onKeyDown={moveBetweenTabs}
      className={cn("no-scrollbar flex overflow-x-auto", className)}
    >
      {children}
    </div>
  );
};

interface TabProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onSelect" | "title"> {
  selected: boolean;
  onSelect: () => void;
  onClose?: () => void;
  closeLabel?: string;
  closeIcon?: React.ReactNode;
  title?: string;
  tabId?: string;
  controls?: string;
  tabClassName?: string;
}

export const Tab = forwardRef<HTMLDivElement, TabProps>(
  (
    {
      selected,
      onSelect,
      onClose,
      closeLabel = "Close",
      closeIcon,
      title,
      tabId,
      controls,
      className,
      tabClassName,
      children,
      ...rest
    },
    ref,
  ) => (
    <div
      ref={ref}
      role="presentation"
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onAuxClick={(e) => e.button === 1 && onClose?.()}
      className={cn(
        "group relative flex shrink-0 items-center has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-accent/70 has-[:focus-visible]:ring-inset",
        className,
      )}
      {...rest}
    >
      <button
        type="button"
        role="tab"
        id={tabId}
        aria-selected={selected}
        aria-controls={controls}
        tabIndex={selected ? 0 : -1}
        title={title}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Delete" && onClose) {
            e.preventDefault();
            onClose();
          }
        }}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 self-stretch text-left outline-none",
          tabClassName,
        )}
      >
        {children}
      </button>
      {onClose && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={closeLabel}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded text-faint hover:bg-active hover:text-fg",
            !closeIcon &&
              !selected &&
              "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
          )}
        >
          {closeIcon ?? <X className="size-3" />}
        </button>
      )}
    </div>
  ),
);
Tab.displayName = "Tab";

export const panelTabClass = (active: boolean) =>
  cn(
    "h-full cursor-default rounded-md pr-0.5 pl-2 text-[11.5px]",
    active ? "bg-active text-fg" : "text-muted hover:bg-hover hover:text-fg",
  );
