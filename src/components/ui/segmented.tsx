import { cn } from "@/lib/utils";

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
};

interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
}

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: SegmentedProps<T>) => (
  <div role="group" className="inline-flex rounded-md border border-border-strong bg-bg p-0.5">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        onClick={() => onChange(option.value)}
        className={cn(
          "flex items-center gap-1 rounded [&_svg]:size-3",
          size === "sm" ? "h-5 px-1.5 text-[11px]" : "h-7 px-3 text-xs",
          value === option.value ? "bg-active text-fg" : "text-faint hover:text-fg",
        )}
      >
        {option.icon}
        {option.label}
      </button>
    ))}
  </div>
);
