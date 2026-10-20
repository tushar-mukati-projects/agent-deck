import { useId } from "react";

import { toggleHideMode } from "@/actions/hide-mode";
import { Segmented } from "@/components/ui/segmented";
import { CustomAgentsEditor, DefaultAgentPicker } from "@/features/settings/AgentSettings";
import { Field, Group, OnOffToggle, TextField, Toggle } from "@/features/settings/fields";
import { ThemePicker } from "@/features/settings/ThemePicker";
import { shortcutLabel } from "@/lib/shortcuts";
import { useSessionsStore } from "@/stores/sessions-store";
import {
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
  useSettingsStore,
  type ClickBehavior,
} from "@/stores/settings-store";

const HideModeToggle = () => {
  const hidden = useSettingsStore((s) => s.hideMode);
  return <OnOffToggle value={hidden} onChange={(on) => on !== hidden && toggleHideMode()} />;
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
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          value={fontSize}
          onChange={(e) => useSettingsStore.getState().set({ fontSize: Number(e.target.value) })}
          className="w-56 accent-[var(--color-accent)]"
        />
        <span className="font-mono text-xs text-muted tabular-nums">{fontSize}px</span>
      </div>
    </Field>
  );
};

export const AppearanceSection = () => (
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
    <Field
      label="Deck pet"
      hint="Deckie lives in the bottom right corner: it naps when nothing runs, works along with Claude, waves when a session needs you and celebrates when one finishes."
    >
      <Toggle field="pet" />
    </Field>
    <Field
      label="Hide mode"
      hint={`Looks like Warp: Warp's name and icon, the One Dark theme, no search bar, title bar buttons, extra status items or pet, and no sounds, voice or desktop notifications (phone pings still arrive). Notes and settings stay on ${shortcutLabel("notes")} and ${shortcutLabel("settings")}. Turning it off brings your theme back. Also ${shortcutLabel("toggleHideMode")}.`}
    >
      <HideModeToggle />
    </Field>
  </>
);

export const AgentsSection = () => {
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

export const SessionsSection = () => {
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
          onChange={(next) => useSettingsStore.getState().set({ clickBehavior: next })}
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

export const TerminalSection = () => {
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
