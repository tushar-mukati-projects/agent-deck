export type ShortcutAction =
  | "palette"
  | "quickOpen"
  | "searchChats"
  | "toggleSessions"
  | "toggleContext"
  | "showSessions"
  | "showExplorer"
  | "showChanges"
  | "showAgentConfig"
  | "toggleShell"
  | "newShell"
  | "newSession"
  | "nextWorkspace"
  | "prevWorkspace"
  | "reopenTab"
  | "nextAttention"
  | "closeFile"
  | "fontBigger"
  | "fontSmaller"
  | "fontReset"
  | "settings"
  | "toggleHideMode"
  | "shortcuts";

export type ShortcutGroup = "General" | "Sessions & tabs" | "Views" | "Terminal & files";

interface Shortcut {
  action: ShortcutAction;
  key: string;
  ctrl?: boolean;
  shift?: boolean | "any";
  alt?: boolean;
  label: string;
  description: string;
  group: ShortcutGroup;
  passToShell?: boolean;
  passToEditor?: boolean;
}

export const SHORTCUTS: Shortcut[] = [
  {
    action: "palette",
    key: "p",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift P",
    description: "Command palette",
    group: "General",
  },
  {
    action: "quickOpen",
    key: "p",
    ctrl: true,
    label: "Ctrl P",
    description: "Go to file",
    group: "General",
    passToShell: true,
  },
  {
    action: "searchChats",
    key: "f",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift F",
    description: "Search inside conversations",
    group: "General",
  },
  {
    action: "settings",
    key: ",",
    ctrl: true,
    label: "Ctrl ,",
    description: "Settings",
    group: "General",
  },
  {
    action: "shortcuts",
    key: "/",
    ctrl: true,
    label: "Ctrl /",
    description: "Keyboard shortcuts",
    group: "General",
    passToEditor: true,
  },
  {
    action: "toggleHideMode",
    key: "h",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift H",
    description: "Hide mode: look like Warp",
    group: "General",
  },
  {
    action: "newSession",
    key: "n",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift N",
    description: "New session in this folder",
    group: "Sessions & tabs",
  },
  {
    action: "nextWorkspace",
    key: "tab",
    ctrl: true,
    label: "Ctrl Tab",
    description: "Next tab",
    group: "Sessions & tabs",
  },
  {
    action: "prevWorkspace",
    key: "tab",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift Tab",
    description: "Previous tab",
    group: "Sessions & tabs",
  },
  {
    action: "reopenTab",
    key: "t",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift T",
    description: "Reopen closed tab",
    group: "Sessions & tabs",
  },
  {
    action: "nextAttention",
    key: "a",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift A",
    description: "Jump to session waiting for you",
    group: "Sessions & tabs",
  },
  {
    action: "toggleSessions",
    key: "b",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift B",
    description: "Show or hide the sessions list",
    group: "Views",
  },
  {
    action: "toggleContext",
    key: "b",
    ctrl: true,
    alt: true,
    label: "Ctrl Alt B",
    description: "Show or hide the session panel (files, changes, Claude)",
    group: "Views",
  },
  {
    action: "showSessions",
    key: "s",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift S",
    description: "Search sessions",
    group: "Views",
  },
  {
    action: "showExplorer",
    key: "e",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift E",
    description: "Files of this session",
    group: "Views",
  },
  {
    action: "showChanges",
    key: "g",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift G",
    description: "What changed in this session",
    group: "Views",
  },
  {
    action: "showAgentConfig",
    key: "j",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift J",
    description: "Agent config: memory, MCP servers, skills",
    group: "Views",
  },
  {
    action: "toggleShell",
    key: "`",
    ctrl: true,
    label: "Ctrl `",
    description: "Toggle shell panel",
    group: "Terminal & files",
  },
  {
    action: "newShell",
    key: "`",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift `",
    description: "New shell",
    group: "Terminal & files",
  },
  {
    action: "closeFile",
    key: "w",
    ctrl: true,
    shift: true,
    label: "Ctrl Shift W",
    description: "Close file tab",
    group: "Terminal & files",
  },
  {
    action: "fontBigger",
    key: "=",
    ctrl: true,
    shift: "any",
    label: "Ctrl +",
    description: "Bigger terminal font",
    group: "Terminal & files",
  },
  {
    action: "fontSmaller",
    key: "-",
    ctrl: true,
    label: "Ctrl -",
    description: "Smaller terminal font",
    group: "Terminal & files",
  },
  {
    action: "fontReset",
    key: "0",
    ctrl: true,
    label: "Ctrl 0",
    description: "Reset terminal font",
    group: "Terminal & files",
  },
];

export const EXTRA_SHORTCUT_HINTS: { label: string; description: string; group: ShortcutGroup }[] =
  [
    { label: "Ctrl 1…9", description: "Jump to tab", group: "Sessions & tabs" },
    { label: "Ctrl F", description: "Find in terminal", group: "Terminal & files" },
    { label: "Shift Enter", description: "New line in Claude prompt", group: "Terminal & files" },
    { label: "Ctrl C", description: "Copy selection in terminal", group: "Terminal & files" },
  ];

const CODE_KEYS: Record<string, string> = {
  Backquote: "`",
  Equal: "=",
  NumpadAdd: "=",
  Minus: "-",
  NumpadSubtract: "-",
  Numpad0: "0",
  Slash: "/",
};

const normalizedKey = (event: KeyboardEvent) => {
  if (CODE_KEYS[event.code]) return CODE_KEYS[event.code];
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3).toLowerCase();
  return event.key.toLowerCase();
};

const find = (event: KeyboardEvent) => {
  if (event.type !== "keydown" || event.metaKey) return null;
  const key = normalizedKey(event);
  return (
    SHORTCUTS.find(
      (s) =>
        s.key === key &&
        !!s.ctrl === event.ctrlKey &&
        (s.shift === "any" || !!s.shift === event.shiftKey) &&
        !!s.alt === event.altKey,
    ) ?? null
  );
};

const focusedTerminalKind = () =>
  (document.activeElement?.closest("[data-terminal-kind]") as HTMLElement | null)?.dataset
    .terminalKind ?? null;

const editorFocused = () => !!document.activeElement?.closest(".cm-editor");

export const matchShortcut = (event: KeyboardEvent): ShortcutAction | null => {
  const shortcut = find(event);
  if (!shortcut) return null;
  if (shortcut.passToShell && focusedTerminalKind() === "shell") return null;
  if (shortcut.passToEditor && editorFocused()) return null;
  return shortcut.action;
};

export const matchTabNumber = (event: KeyboardEvent) => {
  if (event.type !== "keydown" || !event.ctrlKey || event.shiftKey || event.altKey) return null;
  const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
  return digit ? Number(digit) : null;
};

export const shortcutLabel = (action: ShortcutAction) =>
  SHORTCUTS.find((s) => s.action === action)?.label ?? "";
