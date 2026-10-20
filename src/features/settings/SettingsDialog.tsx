import { useState } from "react";
import { Bell, Bot, MessagesSquare, Palette, SquareTerminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { NotificationsSection } from "@/features/settings/NotificationSettings";
import {
  AgentsSection,
  AppearanceSection,
  SessionsSection,
  TerminalSection,
} from "@/features/settings/sections";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

type SectionId = "appearance" | "agents" | "sessions" | "terminal" | "notifications";

type Section = {
  id: SectionId;
  label: string;
  description: string;
  icon: React.ReactNode;
  Section: React.ComponentType;
};

const SECTIONS: Section[] = [
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme and colors.",
    icon: <Palette />,
    Section: AppearanceSection,
  },
  {
    id: "agents",
    label: "Agents",
    description: "Which agent starts new sessions, and the flags each one gets.",
    icon: <Bot />,
    Section: AgentsSection,
  },
  {
    id: "sessions",
    label: "Sessions",
    description: "How the sessions list behaves and which sessions it includes.",
    icon: <MessagesSquare />,
    Section: SessionsSection,
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Shells and terminal text.",
    icon: <SquareTerminal />,
    Section: TerminalSection,
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "How Deck tells you an agent is done.",
    icon: <Bell />,
    Section: NotificationsSection,
  },
];

export const SettingsDialog = () => {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const [sectionId, setSectionId] = useState<SectionId>("appearance");
  const section = SECTIONS.find((s) => s.id === sectionId) ?? SECTIONS[0];

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Settings"
      description="Preferences are saved on this machine."
      hideHeader
      className="top-[7%] w-[min(880px,calc(100vw-48px))] overflow-hidden"
    >
      <div className="flex h-[min(640px,80vh)]">
        <nav
          aria-label="Settings sections"
          className="flex w-[196px] shrink-0 flex-col border-r border-border bg-panel p-2"
        >
          <p className="px-2.5 pt-2 pb-3 text-[15px] font-semibold text-fg">Settings</p>
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={item.id === section.id ? "page" : undefined}
              onClick={() => setSectionId(item.id)}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-[12.5px] [&_svg]:size-4 [&_svg]:shrink-0",
                item.id === section.id
                  ? "bg-active font-medium text-fg"
                  : "text-muted hover:bg-hover hover:text-fg",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          <p className="mt-auto px-2.5 pb-1 text-[11px] leading-snug text-faint">
            Changes save automatically.
          </p>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col bg-bg">
          <header className="shrink-0 border-b border-border px-6 pt-4 pb-3">
            <h2 className="text-[15px] font-semibold text-fg">{section.label}</h2>
            <p className="mt-0.5 text-[12px] text-faint">{section.description}</p>
          </header>
          <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto px-6 py-3">
            <section.Section />
          </div>
          <footer className="flex shrink-0 justify-end border-t border-border px-6 py-3">
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </footer>
        </div>
      </div>
    </Dialog>
  );
};
