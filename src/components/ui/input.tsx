import { cn } from "@/lib/utils";

const inputClass =
  "h-8 w-full rounded-md border border-border-strong bg-bg px-2.5 text-[12.5px] text-fg outline-none placeholder:text-faint focus:border-accent/60 disabled:opacity-50";

export const selectClass =
  "h-8 rounded-md border border-border-strong bg-bg px-2 text-xs text-fg outline-none focus:border-accent/70";

export const Input = ({ className, ...props }: React.ComponentProps<"input">) => (
  <input className={cn(inputClass, className)} {...props} />
);
