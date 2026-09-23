export type ShortcutAction =
  | "palette"
  | "quickOpen"
  | "toggleSidebar"
  | "showSessions"
  | "showExplorer"
  | "showChanges"
  | "toggleShell"
  | "newShell"
  | "newSession"
  | "nextWorkspace"
  | "prevWorkspace"
  | "closeFile"
  | "fontBigger"
  | "fontSmaller"
  | "fontReset"
  | "settings";

interface Shortcut {
  action: ShortcutAction;
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  label: string;
}

export const SHORTCUTS: Shortcut[] = [
  { action: "palette", key: "p", ctrl: true, shift: true, label: "Ctrl Shift P" },
  { action: "quickOpen", key: "p", ctrl: true, label: "Ctrl P" },
  { action: "toggleSidebar", key: "b", ctrl: true, shift: true, label: "Ctrl Shift B" },
  { action: "showSessions", key: "s", ctrl: true, shift: true, label: "Ctrl Shift S" },
  { action: "showExplorer", key: "e", ctrl: true, shift: true, label: "Ctrl Shift E" },
  { action: "showChanges", key: "g", ctrl: true, shift: true, label: "Ctrl Shift G" },
  { action: "toggleShell", key: "`", ctrl: true, label: "Ctrl `" },
  { action: "newShell", key: "`", ctrl: true, shift: true, label: "Ctrl Shift `" },
  { action: "newSession", key: "n", ctrl: true, shift: true, label: "Ctrl Shift N" },
  { action: "nextWorkspace", key: "tab", ctrl: true, label: "Ctrl Tab" },
  { action: "prevWorkspace", key: "tab", ctrl: true, shift: true, label: "Ctrl Shift Tab" },
  { action: "closeFile", key: "w", ctrl: true, shift: true, label: "Ctrl Shift W" },
  { action: "fontBigger", key: "=", ctrl: true, label: "Ctrl +" },
  { action: "fontSmaller", key: "-", ctrl: true, label: "Ctrl -" },
  { action: "fontReset", key: "0", ctrl: true, label: "Ctrl 0" },
  { action: "settings", key: ",", ctrl: true, label: "Ctrl ," },
];

const normalizedKey = (event: KeyboardEvent) => {
  if (event.code === "Backquote") return "`";
  if (event.code === "Equal") return "=";
  if (event.code === "Minus") return "-";
  return event.key.toLowerCase();
};

export const matchShortcut = (event: KeyboardEvent): ShortcutAction | null => {
  if (event.type !== "keydown") return null;
  const key = normalizedKey(event);
  const found = SHORTCUTS.find(
    (s) =>
      s.key === key &&
      !!s.ctrl === event.ctrlKey &&
      !!s.shift === event.shiftKey &&
      !!s.alt === event.altKey,
  );
  return found?.action ?? null;
};

export const shortcutLabel = (action: ShortcutAction) =>
  SHORTCUTS.find((s) => s.action === action)?.label ?? "";
