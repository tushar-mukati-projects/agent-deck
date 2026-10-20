import type { ITheme } from "@xterm/xterm";

import { contrast, ensureContrast } from "@/lib/contrast";
import { ONE_DARK_PALETTE, THEME_PALETTES } from "@/lib/theme-palettes";

type ThemeKind = "dark" | "light";

type Ansi = [
  black: string,
  red: string,
  green: string,
  yellow: string,
  blue: string,
  magenta: string,
  cyan: string,
  white: string,
  brightBlack: string,
  brightRed: string,
  brightGreen: string,
  brightYellow: string,
  brightBlue: string,
  brightMagenta: string,
  brightCyan: string,
  brightWhite: string,
];

export interface ThemeInput {
  id: string;
  name: string;
  kind: ThemeKind;
  bg: string;
  panel: string;
  chrome?: string;
  elevated: string;
  hover: string;
  active: string;
  border: string;
  borderStrong: string;
  fg: string;
  muted: string;
  faint: string;
  accent: string;
  accentStrong?: string;
  onAccent: string;
  ansi: Ansi;
  codeBg?: string;
  syntax?: Partial<Syntax>;
}

interface Syntax {
  comment: string;
  keyword: string;
  string: string;
  number: string;
  function: string;
  type: string;
  property: string;
  tag: string;
  variable: string;
  operator: string;
  heading: string;
  link: string;
}

export interface Theme {
  id: string;
  name: string;
  kind: ThemeKind;
  vars: Record<string, string>;
  terminal: ITheme;
  terminalContrast: number;
  swatch: {
    bg: string;
    panel: string;
    chrome: string;
    accent: string;
    fg: string;
    code: [string, string, string];
  };
}

const FLOORS = {
  light: {
    fg: 7.5,
    muted: 5.2,
    faint: 3.9,
    border: 1.32,
    borderStrong: 1.7,
    hover: 1.06,
    active: 1.14,
    color: 3.6,
    syntax: 4.5,
    comment: 3.8,
    accent: 3.2,
    onAccent: 4.5,
  },
  dark: {
    fg: 7,
    muted: 5.5,
    faint: 3.9,
    border: 1.25,
    borderStrong: 1.55,
    hover: 1.04,
    active: 1.1,
    color: 3.2,
    syntax: 3.6,
    comment: 3.8,
    accent: 3,
    onAccent: 4.5,
  },
};

type Floor = (typeof FLOORS)[ThemeKind];

type UiColors = ReturnType<typeof uiColors>;

const uiColors = (input: ThemeInput, floor: Floor) => {
  const onBg = (color: string, ratio: number) => ensureContrast(color, input.bg, ratio);
  const onPanel = (color: string, ratio: number) => ensureContrast(color, input.panel, ratio);
  const [, red, green, yellow, blue, magenta, cyan] = input.ansi;
  const fillFor = (color: string) => {
    const visible = onBg(color, floor.accent);
    return contrast(input.onAccent, visible) >= floor.onAccent
      ? visible
      : ensureContrast(visible, input.onAccent, floor.onAccent);
  };
  return {
    red: onBg(red, floor.color),
    green: onBg(green, floor.color),
    yellow: onBg(yellow, floor.color),
    blue: onBg(blue, floor.color),
    magenta: onBg(magenta, floor.color),
    cyan: onBg(cyan, floor.color),
    fg: onPanel(onBg(input.fg, floor.fg), floor.fg),
    muted: onPanel(input.muted, floor.muted),
    faint: onPanel(input.faint, floor.faint),
    hover: onPanel(input.hover, floor.hover),
    active: onPanel(input.active, floor.active),
    border: onBg(input.border, floor.border),
    borderStrong: onBg(input.borderStrong, floor.borderStrong),
    accent: fillFor(input.accent),
    accentStrong: fillFor(input.accentStrong ?? input.accent),
  };
};

const syntaxColors = (input: ThemeInput, floor: Floor, codeBg: string) => {
  const [, red, green, yellow, blue, magenta, cyan] = input.ansi;
  const syntax: Syntax = {
    comment: input.faint,
    keyword: magenta,
    string: green,
    number: yellow,
    function: blue,
    type: yellow,
    property: cyan,
    tag: red,
    variable: input.fg,
    operator: input.muted,
    heading: blue,
    link: blue,
    ...input.syntax,
  };
  for (const key of Object.keys(syntax) as (keyof Syntax)[]) {
    const ratio = key === "comment" ? floor.comment : floor.syntax;
    syntax[key] = ensureContrast(syntax[key], codeBg, ratio);
  }
  return syntax;
};

const cssVars = (input: ThemeInput, colors: UiColors, syntax: Syntax, codeBg: string) => {
  const { red, green, yellow, blue, magenta, cyan, accent } = colors;
  const dark = input.kind === "dark";
  const vars: Record<string, string> = {
    "--color-bg": input.bg,
    "--color-panel": input.panel,
    "--color-chrome": input.chrome ?? input.panel,
    "--color-elevated": input.elevated,
    "--color-overlay": input.elevated,
    "--color-hover": colors.hover,
    "--color-active": colors.active,
    "--color-border": colors.border,
    "--color-border-strong": colors.borderStrong,
    "--color-fg": colors.fg,
    "--color-muted": colors.muted,
    "--color-faint": colors.faint,
    "--color-accent": accent,
    "--color-accent-strong": colors.accentStrong,
    "--color-accent-soft": `color-mix(in srgb, ${accent} ${dark ? 14 : 16}%, transparent)`,
    "--color-on-accent": input.onAccent,
    "--color-success": green,
    "--color-warning": yellow,
    "--color-danger": red,
    "--color-info": blue,
    "--color-add": green,
    "--color-del": red,
    "--color-mod": yellow,
    "--color-folder": blue,
    "--color-badge": cyan,
    "--color-code-bg": codeBg,
    "--color-terminal-bg": input.bg,
    "--color-selection": `color-mix(in srgb, ${accent} ${dark ? 28 : 22}%, transparent)`,
    "--color-shadow": dark ? "rgb(0 0 0 / 0.55)" : "rgb(15 23 42 / 0.16)",
    "--color-scrim": dark ? "rgb(0 0 0 / 0.5)" : "rgb(15 23 42 / 0.22)",
    "--icon-red": red,
    "--icon-green": green,
    "--icon-yellow": yellow,
    "--icon-blue": blue,
    "--icon-purple": magenta,
    "--icon-cyan": cyan,
    "--icon-orange": accent,
  };
  for (const [key, value] of Object.entries(syntax)) vars[`--syntax-${key}`] = value;
  return vars;
};

const terminalTheme = (input: ThemeInput, colors: UiColors): ITheme => {
  const [
    black,
    ,
    ,
    ,
    ,
    ,
    ,
    white,
    brightBlack,
    brightRed,
    brightGreen,
    brightYellow,
    brightBlue,
    brightMagenta,
    brightCyan,
    brightWhite,
  ] = input.ansi;
  const dark = input.kind === "dark";
  return {
    background: input.bg,
    foreground: colors.fg,
    cursor: colors.accent,
    cursorAccent: input.bg,
    selectionBackground: `${colors.accent}${dark ? "44" : "38"}`,
    selectionInactiveBackground: dark ? "#ffffff14" : "#0000000f",
    scrollbarSliderBackground: `${input.borderStrong}99`,
    scrollbarSliderHoverBackground: input.borderStrong,
    scrollbarSliderActiveBackground: input.faint,
    black,
    red: colors.red,
    green: colors.green,
    yellow: colors.yellow,
    blue: colors.blue,
    magenta: colors.magenta,
    cyan: colors.cyan,
    white,
    brightBlack,
    brightRed,
    brightGreen,
    brightYellow,
    brightBlue,
    brightMagenta,
    brightCyan,
    brightWhite,
  };
};

const defineTheme = (input: ThemeInput): Theme => {
  const floor = FLOORS[input.kind];
  const codeBg = input.codeBg ?? input.bg;
  const colors = uiColors(input, floor);
  const syntax = syntaxColors(input, floor, codeBg);
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    vars: cssVars(input, colors, syntax, codeBg),
    terminal: terminalTheme(input, colors),
    terminalContrast: input.kind === "light" ? 4.5 : 3,
    swatch: {
      bg: input.bg,
      panel: input.panel,
      chrome: input.chrome ?? input.panel,
      accent: colors.accent,
      fg: colors.fg,
      code: [syntax.keyword, syntax.string, syntax.function],
    },
  };
};

export const THEMES: Theme[] = THEME_PALETTES.map(defineTheme);

export const DEFAULT_THEME_ID = THEMES[0].id;

export const ALL_THEMES = [...THEMES, defineTheme(ONE_DARK_PALETTE)];

export const findTheme = (id: string) => ALL_THEMES.find((t) => t.id === id) ?? THEMES[0];

export const applyTheme = (theme: Theme) => {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.vars)) root.style.setProperty(key, value);
  root.dataset.theme = theme.id;
  root.dataset.themeKind = theme.kind;
  root.style.colorScheme = theme.kind;
};
