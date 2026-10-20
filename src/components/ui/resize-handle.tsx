import { Separator } from "react-resizable-panels";

import { cn } from "@/lib/utils";

type ResizeHandleProps = {
  orientation: "horizontal" | "vertical";
};

export const ResizeHandle = ({ orientation }: ResizeHandleProps) => (
  <Separator
    className={cn(
      "relative shrink-0 bg-border transition-colors duration-150 data-[separator=active]:bg-accent data-[separator=hover]:bg-accent/60",
      orientation === "horizontal" ? "w-px" : "h-px",
    )}
  />
);
