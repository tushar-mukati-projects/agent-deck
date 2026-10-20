import { cn } from "@/lib/utils";

type TagTone = "neutral" | "info" | "badge";

type TagProps = {
  tone?: TagTone;
  className?: string;
  children: React.ReactNode;
};

const TONE_CLASS = {
  neutral: "border-border text-[9.5px] tracking-wide text-faint uppercase",
  info: "border-info/35 bg-info/10 text-[9.5px] font-semibold tracking-wide text-info",
  badge: "border-badge/30 bg-badge/10 text-[9px] font-bold tracking-wider text-badge",
} satisfies Record<TagTone, string>;

export const Tag = ({ tone = "neutral", className, children }: TagProps) => (
  <span className={cn("shrink-0 rounded border px-1 leading-[14px]", TONE_CLASS[tone], className)}>
    {children}
  </span>
);
