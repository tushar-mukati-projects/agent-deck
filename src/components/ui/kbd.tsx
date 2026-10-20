import { cn } from "@/lib/utils";

type KbdProps = {
  keys: string;
  className?: string;
};

export const Kbd = ({ keys, className }: KbdProps) => (
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
