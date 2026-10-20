import { Dialog } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { SectionLabel } from "@/components/ui/section-label";
import { EXTRA_SHORTCUT_HINTS, SHORTCUTS, type ShortcutGroup } from "@/lib/shortcuts";
import { useUiStore } from "@/stores/ui-store";

const GROUPS: ShortcutGroup[] = ["General", "Sessions & tabs", "Views", "Terminal & files"];

const rows = [
  ...SHORTCUTS.map(({ label, description, group }) => ({ label, description, group })),
  ...EXTRA_SHORTCUT_HINTS,
];

export const ShortcutsDialog = () => {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Keyboard shortcuts"
      className="w-[min(720px,calc(100vw-48px))]"
    >
      <div className="grid max-h-[65vh] grid-cols-1 gap-x-8 gap-y-5 overflow-y-auto px-5 pt-4 pb-5 sm:grid-cols-2">
        {GROUPS.map((group) => (
          <div key={group}>
            <SectionLabel className="mb-1.5">{group}</SectionLabel>
            {rows
              .filter((row) => row.group === group)
              .map((row) => (
                <div
                  key={row.label}
                  className="flex h-7 items-center justify-between gap-3 text-[12px] text-fg/85"
                >
                  <span className="truncate">{row.description}</span>
                  <Kbd keys={row.label} />
                </div>
              ))}
          </div>
        ))}
      </div>
    </Dialog>
  );
};
