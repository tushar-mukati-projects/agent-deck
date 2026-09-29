import { forwardRef } from "react";

import { cn } from "@/lib/utils";

export const inputClass =
  "h-8 w-full rounded-md border border-border-strong bg-bg px-2.5 text-[12.5px] text-fg outline-none placeholder:text-faint focus:border-accent/60 disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputClass, className)} {...props} />
  ),
);
Input.displayName = "Input";
