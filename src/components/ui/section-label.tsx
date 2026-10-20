import { cn } from "@/lib/utils";

type SectionLabelProps = {
  children: React.ReactNode;
  className?: string;
};

export const SectionLabel = ({ children, className }: SectionLabelProps) => (
  <p className={cn("text-[10.5px] font-semibold tracking-wider text-faint uppercase", className)}>
    {children}
  </p>
);
