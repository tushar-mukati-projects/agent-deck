import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/panel";
import { CustomAgentsEditor, DefaultAgentPicker } from "@/features/settings/AgentSettings";
import { ThemePicker } from "@/features/settings/ThemePicker";
import { playChime } from "@/lib/chime";
import { useSessionsStore } from "@/stores/sessions-store";
import { useSettingsStore, type ClickBehavior, type SettingsData } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";

type TextKey = "claudeArgs" | "codexArgs" | "shellProgram";
type ToggleKey = "matchAgentTheme" | "notifications" | "sound" | "includeWsl";

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
  <div className="grid grid-cols-[170px_1fr] items-start gap-4 py-3">
    <div>
      <label htmlFor={htmlFor} className="block text-[12.5px] font-medium text-fg">
        {label}
      </label>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-faint">{hint}</p>}
    </div>
    <div>{children}</div>
  </div>
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

const ClickBehaviorField = () => {
  const clickBehavior = useSettingsStore((s) => s.clickBehavior);
  return (
    <Field
      label="Clicking a session"
      hint="Double-click, or Enter on the selected session, resumes."
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
  );
};

const FontSizeField = () => {
  const id = useId();
  const fontSize = useSettingsStore((s) => s.fontSize);
  return (
    <Field label="Terminal font size" htmlFor={id}>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          min={9}
          max={22}
          value={fontSize}
          onChange={(e) => setSetting({ fontSize: Number(e.target.value) })}
          className="w-48 accent-[var(--color-accent)]"
        />
        <span className="font-mono text-xs text-muted tabular-nums">{fontSize}px</span>
      </div>
    </Field>
  );
};

const WslField = () => {
  const distros = useSessionsStore((s) => s.distros);
  return (
    <Field
      label="WSL sessions"
      hint={
        distros.length
          ? `Found: ${distros.map((d) => `${d.name}${d.running ? "" : " (stopped)"}`).join(", ")}`
          : "No WSL distributions found."
      }
    >
      <Toggle field="includeWsl" on="Include running distros" off="Windows only" />
    </Field>
  );
};

const EnvironmentFields = () => {
  const shell = useSessionsStore((s) => s.environment?.shell);
  const claudeHome = useSessionsStore((s) => s.environment?.claudeHome);
  return (
    <>
      <TextField
        field="shellProgram"
        label="Shell"
        hint={`Default: ${shell ?? "auto"}`}
        placeholder="pwsh.exe, powershell.exe, cmd.exe, bash.exe…"
      />
      <FontSizeField />
      <WslField />
      <Field label="Claude data folder">
        <p className="pt-1.5 font-mono text-xs break-all text-muted select-text">{claudeHome}</p>
      </Field>
    </>
  );
};

export const SettingsDialog = () => {
  const open = useUiStore((s) => s.settingsOpen);
  const setOpen = useUiStore((s) => s.setSettingsOpen);
  const agentId = useId();

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
          htmlFor={agentId}
          hint="Used by New session (Ctrl Shift N), folder + buttons and Choose folder."
        >
          <DefaultAgentPicker id={agentId} />
        </Field>
        <Field
          label="Claude's colors"
          hint="Start Claude with its light or dark theme to match Deck, so prompts and diffs look right. Running sessions update when resumed."
        >
          <Toggle field="matchAgentTheme" on="Match Deck theme" off="Use Claude's own setting" />
        </Field>
        <TextField
          field="claudeArgs"
          label="Extra Claude flags"
          hint="Added to every Claude session you start or resume. Quote values with spaces."
          placeholder="e.g. --permission-mode acceptEdits --model opus"
        />
        <TextField
          field="codexArgs"
          label="Extra Codex flags"
          hint="Added to every Codex session you start, resume or fork."
          placeholder="e.g. --model gpt-5 --sandbox workspace-write"
        />
        <Field
          label="Other agents"
          hint="Any CLI agent (Gemini, Aider, OpenCode…) can start new sessions from Deck. Resume and history are available for Claude and Codex."
        >
          <CustomAgentsEditor />
        </Field>
        <ClickBehaviorField />
        <Field
          label="When an agent finishes"
          hint="Sound plays every time; notifications only for sessions you're not looking at."
        >
          <div className="flex items-center gap-2">
            <Toggle field="notifications" on="Notify" off="Off" />
            <Toggle field="sound" on="Sound" off="Silent" />
            <Button size="sm" variant="ghost" onClick={() => void playChime("done")}>
              Test
            </Button>
          </div>
        </Field>
        <EnvironmentFields />
      </div>
      <div className="flex justify-end px-5 pt-2 pb-4">
        <Button variant="primary" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </Dialog>
  );
};
