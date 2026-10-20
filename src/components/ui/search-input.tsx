import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

interface SearchInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

export const SearchInput = ({
  value,
  onChange,
  className,
  inputRef,
  onKeyDown,
  placeholder,
  "aria-label": ariaLabel,
  ...props
}: SearchInputProps) => (
  <div
    className={cn(
      "flex h-7 items-center gap-2 rounded-md border border-border bg-bg px-2 focus-within:border-border-strong",
      className,
    )}
  >
    <Search className="size-3.5 shrink-0 text-faint" />
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && value) {
          e.stopPropagation();
          onChange("");
        }
        onKeyDown?.(e);
      }}
      className="h-full min-w-0 flex-1 bg-transparent text-xs text-fg outline-none placeholder:text-faint"
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      {...props}
    />
    {value && (
      <button
        type="button"
        aria-label="Clear search"
        onClick={() => onChange("")}
        className="text-faint hover:text-fg"
      >
        <X className="size-3.5" />
      </button>
    )}
  </div>
);
