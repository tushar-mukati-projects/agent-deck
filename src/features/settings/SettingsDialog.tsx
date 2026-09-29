import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { CustomAgentsEditor, DefaultAgentPicker } from "@/features/settings/AgentSettings";
import { ThemePicker } from "@/features/settings/ThemePicker";
import { playChime } from "@/lib/chime";
import { cn } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore, type ClickBehavior } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";

const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) => (
  <div className="grid grid-cols-[170px_1fr] items-start gap-4 py-3">
    <div>
      <p className="text-[12.5px] font-medium text-fg">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-faint">{hint}</p>}
    </div>
    <div>{children}</div>
  </div>
);

const inputClass =
  "h-8 w-full rounded-md border border-border-strong bg-bg px-2.5 font-mono text-xs text-fg outline-none placeholder:text-faint focus:border-accent/70";

const Segmented = <T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) => (
  <div className="inline-flex rounded-md border border-border-strong bg-bg p-0.5">
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => onChange(option.value)}
        className={cn(
          "h-7 rounded px-3 text-xs",
          value === option.value ? "bg-active text-fg" : "text-faint hover:text-fg",
        )}
      >
        {option.label}
      </button>
    ))}
  </div>
);

export const SettingsDialog = () => {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const settings = useSettingsStore();
  const environment = useSessionsStore((s) => s.environment);
  const distros = useSessionsStore((s) => s.distros);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Settings"
      description="Preferences are saved on this machine."
      className="top-[7%] w-[min(720px,calc(100vw-48px))]"
    >
      <div className="max-h-[74vh] divide-y divide-border overflow-y-auto px-5 pt-2">
        <Field label="Theme" hint="Colors for the whole app, terminals, code and diffs.">
          <ThemePicker />
        </Field>
        <Field
          label="Default agent"
          hint="Used by New session (Ctrl Shift N), folder + buttons and Choose folder."
        >
          <DefaultAgentPicker />
        </Field>
        <Field label="Extra Claude flags" hint="Added to every Claude session you start or resume.">
          <input
            className={inputClass}
            value={settings.claudeArgs}
            placeholder="e.g. --permission-mode acceptEdits --model opus"
            onChange={(e) => settings.set({ claudeArgs: e.target.value })}
            spellCheck={false}
          />
        </Field>
        <Field
          label="Extra Codex flags"
          hint="Added to every Codex session you start, resume or fork."
        >
          <input
            className={inputClass}
            value={settings.codexArgs}
            placeholder="e.g. --model gpt-5 --sandbox workspace-write"
            onChange={(e) => settings.set({ codexArgs: e.target.value })}
            spellCheck={false}
          />
        </Field>
        <Field
          label="Other agents"
          hint="Any CLI agent (Gemini, Aider, OpenCode…) can start new sessions from Deck. Resume and history are available for Claude and Codex."
        >
          <CustomAgentsEditor />
        </Field>
        <Field label="Clicking a session" hint="Double-click always resumes.">
          <Segmented<ClickBehavior>
            value={settings.clickBehavior}
            onChange={(clickBehavior) => settings.set({ clickBehavior })}
            options={[
              { value: "preview", label: "Preview conversation" },
              { value: "resume", label: "Resume immediately" },
            ]}
          />
        </Field>
        <Field
          label="When an agent finishes"
          hint="Sound plays every time; notifications only for sessions you're not looking at."
        >
          <div className="flex items-center gap-2">
            <Segmented<"on" | "off">
              value={settings.notifications ? "on" : "off"}
              onChange={(value) => settings.set({ notifications: value === "on" })}
              options={[
                { value: "on", label: "Notify" },
                { value: "off", label: "Off" },
              ]}
            />
            <Segmented<"on" | "off">
              value={settings.sound ? "on" : "off"}
              onChange={(value) => settings.set({ sound: value === "on" })}
              options={[
                { value: "on", label: "Sound" },
                { value: "off", label: "Silent" },
              ]}
            />
            <Button size="sm" variant="ghost" onClick={() => void playChime("done")}>
              Test
            </Button>
          </div>
        </Field>
        <Field label="Shell" hint={`Default: ${environment?.shell ?? "auto"}`}>
          <input
            className={inputClass}
            value={settings.shellProgram}
            placeholder="pwsh.exe, powershell.exe, cmd.exe, bash.exe…"
            onChange={(e) => settings.set({ shellProgram: e.target.value })}
            spellCheck={false}
          />
        </Field>
        <Field label="Terminal font size">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={9}
              max={22}
              value={settings.fontSize}
              onChange={(e) => settings.set({ fontSize: Number(e.target.value) })}
              className="w-48 accent-[var(--color-accent)]"
            />
            <span className="font-mono text-xs text-muted tabular-nums">{settings.fontSize}px</span>
          </div>
        </Field>
        <Field
          label="WSL sessions"
          hint={
            distros.length
              ? `Found: ${distros.map((d) => `${d.name}${d.running ? "" : " (stopped)"}`).join(", ")}`
              : "No WSL distributions found."
          }
        >
          <Segmented<"on" | "off">
            value={settings.includeWsl ? "on" : "off"}
            onChange={(value) => settings.set({ includeWsl: value === "on" })}
            options={[
              { value: "on", label: "Include running distros" },
              { value: "off", label: "Windows only" },
            ]}
          />
        </Field>
        <Field label="Claude data folder">
          <p className="pt-1.5 font-mono text-xs break-all text-muted select-text">
            {environment?.claudeHome}
          </p>
        </Field>
      </div>
      <div className="flex justify-end px-5 pt-2 pb-4">
        <Button variant="primary" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </Dialog>
  );
};
