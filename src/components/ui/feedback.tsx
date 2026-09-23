import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type DotTone = "running" | "busy" | "attention" | "external" | "exited" | "error";

const toneClass: Record<DotTone, string> = {
  running: "bg-success",
  busy: "bg-accent animate-pulse-dot",
  attention: "bg-info",
  external: "bg-warning",
  exited: "bg-faint",
  error: "bg-danger",
};

export const StatusDot = ({ tone, className }: { tone: DotTone; className?: string }) => (
  <span
    className={cn("inline-block size-[7px] shrink-0 rounded-full", toneClass[tone], className)}
  />
);

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={cn("size-4 animate-spin text-faint", className)} />
);

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState = ({ icon, title, description, action, className }: EmptyStateProps) => (
  <div
    className={cn(
      "flex flex-col items-center justify-center gap-2 px-6 py-10 text-center",
      className,
    )}
  >
    <div className="mb-1 flex size-10 items-center justify-center rounded-xl border border-border bg-elevated text-faint [&_svg]:size-[18px]">
      {icon}
    </div>
    <p className="text-[13px] font-medium text-fg">{title}</p>
    {description && (
      <p className="max-w-[280px] text-xs leading-relaxed text-faint">{description}</p>
    )}
    {action && <div className="mt-2">{action}</div>}
  </div>
);
