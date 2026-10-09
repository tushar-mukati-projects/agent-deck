import { Check } from "lucide-react";

import { findTheme, THEMES, type Theme } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";

const ThemeCard = ({
  theme,
  selected,
  onSelect,
}: {
  theme: Theme;
  selected: boolean;
  onSelect: () => void;
}) => {
  const { bg, panel, chrome, accent, fg, code } = theme.swatch;
  return (
    <button
      type="button"
      onClick={onSelect}
      title={theme.name}
      aria-pressed={selected}
      className={cn(
        "group flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors",
        selected ? "border-accent" : "border-border hover:border-border-strong",
      )}
    >
      <div
        className="relative h-14 overflow-hidden rounded-md border border-black/10"
        style={{ background: bg }}
      >
        <div className="absolute inset-x-0 top-0 h-2.5" style={{ background: chrome }} />
        <div className="absolute top-2.5 bottom-0 left-0 w-1/3" style={{ background: panel }}>
          <div className="mt-2 ml-1.5 h-1 w-6 rounded-full opacity-70" style={{ background: fg }} />
          <div className="mt-1 ml-1.5 h-1 w-4 rounded-full opacity-40" style={{ background: fg }} />
          <div className="mt-1 ml-1.5 h-1 w-5 rounded-full opacity-40" style={{ background: fg }} />
        </div>
        <div className="absolute top-5 left-[42%] flex gap-1">
          <div className="h-1 w-3 rounded-full" style={{ background: code[0] }} />
          <div className="h-1 w-5 rounded-full" style={{ background: code[1] }} />
        </div>
        <div className="absolute top-7.5 left-[42%] flex gap-1">
          <div className="h-1 w-4 rounded-full" style={{ background: code[2] }} />
          <div className="h-1 w-3 rounded-full opacity-50" style={{ background: fg }} />
        </div>
        <div
          className="absolute right-2 bottom-2 h-2.5 w-7 rounded-sm"
          style={{ background: accent }}
        />
        {selected && (
          <span
            className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full"
            style={{ background: accent, color: bg }}
          >
            <Check className="size-2.5" strokeWidth={3} />
          </span>
        )}
      </div>
      <span
        className={cn(
          "truncate px-0.5 text-[11px]",
          selected ? "text-fg" : "text-muted group-hover:text-fg",
        )}
      >
        {theme.name}
      </span>
    </button>
  );
};

export const ThemePicker = () => {
  const current = findTheme(useSettingsStore((s) => s.themeId));
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {THEMES.map((theme) => (
        <ThemeCard
          key={theme.id}
          theme={theme}
          selected={theme.id === current.id}
          onSelect={() => useSettingsStore.getState().set({ themeId: theme.id })}
        />
      ))}
    </div>
  );
};
