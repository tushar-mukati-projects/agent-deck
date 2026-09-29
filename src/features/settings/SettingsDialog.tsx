import { useId, useState } from "react";
import { Bell, Bot, MessagesSquare, Palette, SquareTerminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/panel";
import { CustomAgentsEditor, DefaultAgentPicker } from "@/features/settings/AgentSettings";
import { ThemePicker } from "@/features/settings/ThemePicker";
import { playChime } from "@/lib/chime";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore, type ClickBehavior, type SettingsData } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";

type TextKey = "claudeArgs" | "codexArgs" | "shellProgram";
type ToggleKey = "matchAgentTheme" | "notifications" | "sound" | "includeWsl";
type SectionId = "appearance" | "agents" | "sessions" | "terminal" | "notifications";

const setSetting = (patch: Partial<SettingsData>) => useSettingsStore.getState().set(patch);

const Field = ({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
}) => (
  <div className="py-4 first:pt-1">
    <label htmlFor={htmlFor} className="block text-[12.5px] font-medium text-fg">
      {label}
    </label>
    {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-faint">{hint}</p>}
    <div className="mt-2.5">{children}</div>
  </div>
);

const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-lg border border-border px-4 py-1">
    <h3 className="pt-3 text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</h3>
    <div className="divide-y divide-border">{children}</div>
  </section>
);

const TextField = ({
  field,
  label,
  hint,
  placeholder,
}: {
  field: TextKey;
  label: string;
  hint?: string;
  placeholder: string;
}) => {
  const id = useId();
  const value = useSettingsStore((s) => s[field]);
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <Input
        id={id}
        className="font-mono text-xs"
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setSetting({ [field]: e.target.value })}
      />
    </Field>
  );
};

const Toggle = ({ field, on, off }: { field: ToggleKey; on: string; off: string }) => {
  const value = useSettingsStore((s) => s[field]);
  return (
    <Segmented<"on" | "off">
      value={value ? "on" : "off"}
      onChange={(next) => setSetting({ [field]: next === "on" })}
      options={[
        { value: "on", label: on },
        { value: "off", label: off },
      ]}
    />
  );
};

const FontSize = () => {
  const id = useId();
  const fontSize = useSettingsStore((s) => s.fontSize);
  return (
    <Field label="Font size" hint="Also Ctrl + / Ctrl − / Ctrl 0 in any terminal." htmlFor={id}>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={9}
          max={22}
          value={fontSize}
          onChange={(e) => setSetting({ fontSize: Number(e.target.value) })}
          className="w-56 accent-[var(--color-accent)]"
        />
        <span className="font-mono text-xs text-muted tabular-nums">{fontSize}px</span>
      </div>
    </Field>
  );
};

const AppearanceSection = () => (
  <>
    <Field label="Theme" hint="Colors for the whole app, terminals, code and diffs.">
      <ThemePicker />
    </Field>
    <Field
      label="Claude uses Deck colors"
      hint="Claude draws with the Deck theme's own colors, so prompts, code and diffs follow the theme you pick. Switching between a light and a dark theme resumes open Claude sessions with the new colors once each one is idle, so nothing in progress is interrupted."
    >
      <Toggle field="matchAgentTheme" on="Match Deck" off="Use Claude's own setting" />
    </Field>
  </>
);

const AgentsSection = () => {
  const agentId = useId();
  return (
    <div className="flex flex-col gap-4">
      <Field
        label="Default agent"
        htmlFor={agentId}
        hint="Used by New session (Ctrl Shift N), the folder + buttons and Choose folder."
      >
        <DefaultAgentPicker id={agentId} />
      </Field>
      <Group title="Claude">
        <TextField
          field="claudeArgs"
          label="Extra flags"
          hint="Added every time Claude starts or resumes. Quote values that contain spaces."
          placeholder="e.g. --permission-mode acceptEdits --model opus"
        />
      </Group>
      <Group title="Codex">
        <TextField
          field="codexArgs"
          label="Extra flags"
          hint="Added every time Codex starts, resumes or forks."
          placeholder="e.g. --model gpt-5 --sandbox workspace-write"
        />
      </Group>
      <Group title="Other agents">
        <Field
          label="Command-line agents"
          hint="Any CLI agent (Gemini, Aider, OpenCode…) can start new sessions. History, resume and fork are available for Claude and Codex."
        >
          <CustomAgentsEditor />
        </Field>
      </Group>
    </div>
  );
};

const SessionsSection = () => {
  const clickBehavior = useSettingsStore((s) => s.clickBehavior);
  const distros = useSessionsStore((s) => s.distros);
  return (
    <>
      <Field
        label="Clicking a session"
        hint="Double-click, or Enter on the selected session, always resumes."
      >
        <Segmented<ClickBehavior>
          value={clickBehavior}
          onChange={(next) => setSetting({ clickBehavior: next })}
          options={[
            { value: "preview", label: "Preview conversation" },
            { value: "resume", label: "Resume immediately" },
          ]}
        />
      </Field>
      <Field
        label="WSL sessions"
        hint={
          distros.length
            ? `Found ${distros.map((d) => `${d.name}${d.running ? "" : " (stopped)"}`).join(", ")}. Stopped distros are never started on their own.`
            : "No WSL distributions found."
        }
      >
        <Toggle field="includeWsl" on="Include running distros" off="Windows only" />
      </Field>
    </>
  );
};

const TerminalSection = () => {
  const shell = useSessionsStore((s) => s.environment?.shell);
  return (
    <>
      <TextField
        field="shellProgram"
        label="Shell program"
        hint={`Used for new shells in Windows folders. Leave empty for the default (${shell ?? "auto"}).`}
        placeholder="pwsh.exe, powershell.exe, cmd.exe, bash.exe…"
      />
      <FontSize />
    </>
  );
};

const NotificationsSection = () => (
  <>
    <Field
      label="Desktop notifications"
      hint="Shown when an agent finishes or needs approval in a session you're not looking at."
    >
      <Toggle field="notifications" on="On" off="Off" />
    </Field>
    <Field label="Sound" hint="A short chime whenever an agent finishes a turn.">
      <div className="flex items-center gap-2">
        <Toggle field="sound" on="On" off="Silent" />
        <Button size="sm" variant="ghost" onClick={() => void playChime("done")}>
          Play sample
        </Button>
      </div>
    </Field>
  </>
);

const SECTIONS: {
  id: SectionId;
  label: string;
  description: string;
  icon: React.ReactNode;
  render: () => React.ReactNode;
}[] = [
  {
    id: "appearance",
    label: "Appearance",
    description: "Theme and colors.",
    icon: <Palette />,
    render: () => <AppearanceSection />,
  },
  {
    id: "agents",
    label: "Agents",
    description: "Which agent starts new sessions, and the flags each one gets.",
    icon: <Bot />,
    render: () => <AgentsSection />,
  },
  {
    id: "sessions",
    label: "Sessions",
    description: "How the sessions list behaves and which sessions it includes.",
    icon: <MessagesSquare />,
    render: () => <SessionsSection />,
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Shells and terminal text.",
    icon: <SquareTerminal />,
    render: () => <TerminalSection />,
  },
  {
    id: "notifications",
    label: "Notifications",
    description: "How Deck tells you an agent is done.",
    icon: <Bell />,
    render: () => <NotificationsSection />,
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
            {section.render()}
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
