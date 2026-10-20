import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

type ChevronProps = {
  open: boolean;
  className?: string;
};

export const Chevron = ({ open, className }: ChevronProps) => (
  <ChevronRight
    className={cn(
      "size-3 shrink-0 transition-transform duration-100",
      open && "rotate-90",
      className,
    )}
  />
);
