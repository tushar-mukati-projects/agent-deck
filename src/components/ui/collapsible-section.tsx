import { Chevron } from "@/components/ui/chevron";

interface CollapsibleSectionProps {
  title: string;
  count: number | null;
  icon?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  summary?: React.ReactNode;
  children: React.ReactNode;
}

export const CollapsibleSection = ({
  title,
  count,
  icon,
  open,
  onToggle,
  summary,
  children,
}: CollapsibleSectionProps) => (
  <section className="mb-1">
    <div className="flex h-7 items-center pr-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2.5 text-[11px] font-semibold tracking-wide text-muted hover:text-fg [&>svg:not(:first-child)]:size-3.5 [&>svg:not(:first-child)]:shrink-0"
      >
        <Chevron open={open} />
        {icon}
        <span className="truncate">{title}</span>
        {count !== null && (
          <span className="font-normal text-faint tabular-nums">{count}</span>
        )}
        {summary && <span className="ml-auto font-mono font-normal">{summary}</span>}
      </button>
    </div>
    {open && <div className="flex flex-col px-1.5">{children}</div>}
  </section>
);
