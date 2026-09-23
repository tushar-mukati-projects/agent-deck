import { cn } from "@/lib/utils";

export const Kbd = ({ keys, className }: { keys: string; className?: string }) => (
  <span className={cn("inline-flex items-center gap-0.5", className)}>
    {keys.split(" ").map((key) => (
      <kbd
        key={key}
        className="min-w-[18px] rounded border border-border-strong bg-elevated px-1 py-px text-center font-mono text-[10px] leading-[14px] text-muted"
      >
        {key}
      </kbd>
    ))}
  </span>
);
