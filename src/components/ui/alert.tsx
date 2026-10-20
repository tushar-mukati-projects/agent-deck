import { AlertTriangle, Info } from "lucide-react";

import { cn } from "@/lib/utils";

type AlertTone = "danger" | "warning" | "info";

type AlertProps = {
  tone: AlertTone;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

const alertTone: Record<AlertTone, string> = {
  danger: "border-danger/30 bg-danger/10 text-danger",
  warning: "border-warning/30 bg-warning/10 text-warning",
  info: "border-info/30 bg-info/10 text-info",
};

export const Alert = ({ tone, children, action, className }: AlertProps) => {
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
