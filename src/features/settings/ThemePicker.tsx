import { Check } from "lucide-react";

import { THEMES, type Theme } from "@/lib/themes";
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
  const [bg, panel, accent, fg] = theme.swatch;
  return (
    <button
      type="button"
      onClick={onSelect}
      title={theme.name}
      className={cn(
        "group flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors",
        selected ? "border-accent" : "border-border hover:border-border-strong",
      )}
    >
      <div
        className="relative h-12 overflow-hidden rounded-md border border-black/10"
        style={{ background: bg }}
      >
        <div className="absolute inset-y-0 left-0 w-1/3" style={{ background: panel }}>
          <div className="mt-2 ml-1.5 h-1 w-6 rounded-full opacity-70" style={{ background: fg }} />
          <div className="mt-1 ml-1.5 h-1 w-4 rounded-full opacity-40" style={{ background: fg }} />
          <div className="mt-1 ml-1.5 h-1 w-5 rounded-full opacity-40" style={{ background: fg }} />
        </div>
        <div
          className="absolute top-2 left-[42%] h-1 w-10 rounded-full opacity-80"
          style={{ background: fg }}
        />
        <div
          className="absolute top-4.5 left-[42%] h-1 w-7 rounded-full opacity-40"
          style={{ background: fg }}
        />
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
  const themeId = useSettingsStore((s) => s.themeId);
  const set = useSettingsStore((s) => s.set);
  const groups: { label: string; themes: Theme[] }[] = [
    { label: "Dark", themes: THEMES.filter((t) => t.kind === "dark") },
    { label: "Light", themes: THEMES.filter((t) => t.kind === "light") },
  ];
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1.5 text-[10.5px] font-semibold tracking-wider text-faint uppercase">
            {group.label}
          </p>
          <div className="grid grid-cols-4 gap-2">
            {group.themes.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                selected={theme.id === themeId}
                onSelect={() => set({ themeId: theme.id })}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
