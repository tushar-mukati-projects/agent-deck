import { useId } from "react";

import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useSettingsStore, type SettingsData } from "@/stores/settings-store";

type TextKey = "claudeArgs" | "codexArgs" | "shellProgram";
type ToggleKey = "matchAgentTheme" | "notifications" | "sound" | "speech" | "includeWsl" | "pet";

type FieldProps = {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
};

type GroupProps = {
  title: string;
  children: React.ReactNode;
};

type TextFieldProps = {
  field: TextKey;
  label: string;
  hint?: string;
  placeholder: string;
};

type OnOffToggleProps = {
  value: boolean;
  onChange: (on: boolean) => void;
  on?: string;
  off?: string;
};

type ToggleProps = {
  field: ToggleKey;
  on?: string;
  off?: string;
};

export const setSetting = (patch: Partial<SettingsData>) => useSettingsStore.getState().set(patch);

export const Field = ({ label, hint, htmlFor, children }: FieldProps) => (
  <div className="py-4 first:pt-1">
    <label htmlFor={htmlFor} className="block text-[12.5px] font-medium text-fg">
      {label}
    </label>
    {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-faint">{hint}</p>}
    <div className="mt-2.5">{children}</div>
  </div>
);

export const Group = ({ title, children }: GroupProps) => (
  <section className="rounded-lg border border-border px-4 py-1">
    <h3 className="pt-3 text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</h3>
    <div className="divide-y divide-border">{children}</div>
  </section>
);

export const TextField = ({ field, label, hint, placeholder }: TextFieldProps) => {
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

export const OnOffToggle = ({ value, onChange, on = "On", off = "Off" }: OnOffToggleProps) => (
  <Segmented<"on" | "off">
    value={value ? "on" : "off"}
    onChange={(next) => onChange(next === "on")}
    options={[
      { value: "on", label: on },
      { value: "off", label: off },
    ]}
  />
);

export const Toggle = ({ field, on, off }: ToggleProps) => {
  const value = useSettingsStore((s) => s[field]);
  return (
    <OnOffToggle
      value={value}
      onChange={(next) => setSetting({ [field]: next })}
      on={on}
      off={off}
    />
  );
};
