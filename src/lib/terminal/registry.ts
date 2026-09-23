import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";

import { matchShortcut } from "@/lib/shortcuts";
import { api } from "@/lib/tauri/commands";
import { copyText, openExternal } from "@/lib/tauri/system";
import { findTheme } from "@/lib/themes";
import { errorMessage } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import { useTerminalStore } from "@/stores/terminal-store";
import type { PtyEvent, TerminalKind } from "@/types";

export interface TerminalSpec {
  id: string;
  kind: TerminalKind;
  workspaceId: string;
  cwd: string;
  program: string;
  args: string[];
}

interface Entry {
  spec: TerminalSpec;
  term: Terminal;
  fit: FitAddon;
  element: HTMLDivElement;
  webgl: WebglAddon | null;
  opened: boolean;
  spawned: boolean;
  busy: boolean;
  busySince: number;
  quietUntil: number;
  idleTimer: number | undefined;
}

const MAX_WEBGL_CONTEXTS = 6;
const IDLE_AFTER_MS = 1600;
const ECHO_WINDOW_MS = 400;

export interface IdleEvent {
  spec: TerminalSpec;
  busyMs: number;
  needsInput: boolean;
  visible: boolean;
}

const MIN_BUSY_FOR_ALERT_MS = 3000;
const INPUT_PROMPT_PATTERN =
  /Do you want to|Would you like to|\(y\/n\)|❯ 1\. Yes|Enter to confirm|Esc to cancel|Allow this/i;

let idleListener: ((event: IdleEvent) => void) | null = null;

export const onClaudeIdle = (listener: (event: IdleEvent) => void) => {
  idleListener = listener;
  return () => {
    if (idleListener === listener) idleListener = null;
  };
};

const screenTail = (term: Terminal, lines: number) => {
  const buffer = term.buffer.active;
  const end = buffer.baseY + buffer.cursorY;
  const rows: string[] = [];
  for (let y = Math.max(0, end - lines); y <= end; y += 1) {
    rows.push(buffer.getLine(y)?.translateToString(true) ?? "");
  }
  return rows.join("\n");
};

const entries = new Map<string, Entry>();
const webglOrder: string[] = [];
let runningPtys = new Set<string>();

const store = () => useTerminalStore.getState();

export const setRunningPtys = (ids: string[]) => {
  runningPtys = new Set(ids);
};

export const isPtyRunning = (id: string) => runningPtys.has(id);

const releaseWebgl = (entry: Entry) => {
  entry.webgl?.dispose();
  entry.webgl = null;
  const index = webglOrder.indexOf(entry.spec.id);
  if (index >= 0) webglOrder.splice(index, 1);
};

const ensureWebgl = (entry: Entry) => {
  const index = webglOrder.indexOf(entry.spec.id);
  if (index >= 0) webglOrder.splice(index, 1);
  webglOrder.push(entry.spec.id);
  if (!entry.webgl) {
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => releaseWebgl(entry));
      entry.term.loadAddon(addon);
      entry.webgl = addon;
    } catch {
      entry.webgl = null;
    }
  }
  while (webglOrder.length > MAX_WEBGL_CONTEXTS) {
    const oldest = entries.get(webglOrder[0]);
    if (oldest) releaseWebgl(oldest);
    else webglOrder.shift();
  }
};

const markOutput = (entry: Entry) => {
  if (performance.now() < entry.quietUntil) return;
  const { id } = entry.spec;
  if (!entry.busy) {
    entry.busy = true;
    entry.busySince = performance.now();
    store().update(id, { busy: true });
  }
  window.clearTimeout(entry.idleTimer);
  entry.idleTimer = window.setTimeout(() => {
    entry.busy = false;
    const busyMs = performance.now() - entry.busySince - IDLE_AFTER_MS;
    const visible = entry.element.isConnected && document.hasFocus();
    const isClaude = entry.spec.kind === "claude";
    store().update(id, { busy: false, attention: isClaude && !visible });
    if (isClaude && busyMs >= MIN_BUSY_FOR_ALERT_MS) {
      const needsInput = INPUT_PROMPT_PATTERN.test(screenTail(entry.term, 18));
      idleListener?.({ spec: entry.spec, busyMs, needsInput, visible });
    }
  }, IDLE_AFTER_MS);
};

const handlePtyEvent = (entry: Entry) => (event: PtyEvent) => {
  if (event.type === "data") {
    entry.term.write(event.data);
    markOutput(entry);
    return;
  }
  window.clearTimeout(entry.idleTimer);
  entry.busy = false;
  runningPtys.delete(entry.spec.id);
  store().update(entry.spec.id, { status: "exited", exitCode: event.code, busy: false });
};

const sendInput = (entry: Entry, data: string) => {
  entry.quietUntil = performance.now() + ECHO_WINDOW_MS;
  api.ptyWrite(entry.spec.id, data).catch(() => undefined);
};

const pasteFromClipboard = async (entry: Entry) => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) entry.term.paste(text);
  } catch {
    return;
  }
};

const handleKey = (entry: Entry) => (event: KeyboardEvent) => {
  if (matchShortcut(event)) return false;
  if (event.type !== "keydown") return true;
  const { term } = entry;
  const key = event.key.toLowerCase();

  if (event.ctrlKey && !event.altKey && key === "c" && term.hasSelection()) {
    void copyText(term.getSelection());
    term.clearSelection();
    event.preventDefault();
    return false;
  }
  if (event.ctrlKey && event.shiftKey && key === "c") {
    if (term.hasSelection()) void copyText(term.getSelection());
    event.preventDefault();
    return false;
  }
  if (event.ctrlKey && !event.altKey && key === "v") {
    return false;
  }
  if (event.shiftKey && !event.ctrlKey && !event.altKey && key === "enter" && entry.spec.kind === "claude") {
    sendInput(entry, "\x1b\r");
    event.preventDefault();
    return false;
  }
  return true;
};

const handlePaste = (entry: Entry) => (event: ClipboardEvent) => {
  const data = event.clipboardData;
  if (!data || data.getData("text/plain")) return;
  const hasImage = Array.from(data.items).some((item) => item.type.startsWith("image/"));
  if (hasImage && entry.spec.kind === "claude") {
    event.preventDefault();
    event.stopPropagation();
    sendInput(entry, "\x1bv");
  }
};

const handleContextMenu = (entry: Entry) => (event: MouseEvent) => {
  event.preventDefault();
  if (entry.term.hasSelection()) {
    void copyText(entry.term.getSelection());
    entry.term.clearSelection();
  } else {
    void pasteFromClipboard(entry);
  }
};

const createEntry = (spec: TerminalSpec): Entry => {
  const { fontSize, themeId } = useSettingsStore.getState();
  const term = new Terminal({
    allowProposedApi: true,
    fontFamily: '"JetBrains Mono Variable", "Cascadia Code", Consolas, monospace',
    fontSize,
    lineHeight: 1.18,
    letterSpacing: 0,
    fontWeight: 400,
    fontWeightBold: 550,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 2,
    scrollback: 10_000,
    smoothScrollDuration: 90,
    macOptionIsMeta: true,
    minimumContrastRatio: 1,
    drawBoldTextInBrightColors: false,
    theme: findTheme(themeId).terminal,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_event, uri) => void openExternal(uri)));
  const unicode = new Unicode11Addon();
  term.loadAddon(unicode);
  term.unicode.activeVersion = "11";

  const element = document.createElement("div");
  element.className = "h-full w-full";

  const entry: Entry = {
    spec,
    term,
    fit,
    element,
    webgl: null,
    opened: false,
    spawned: false,
    busy: false,
    busySince: 0,
    quietUntil: 0,
    idleTimer: undefined,
  };

  term.attachCustomKeyEventHandler(handleKey(entry));
  term.onData((data) => sendInput(entry, data));
  element.addEventListener("paste", handlePaste(entry), true);
  element.addEventListener("contextmenu", handleContextMenu(entry));
  return entry;
};

const spawnPty = async (entry: Entry) => {
  const { spec, term } = entry;
  entry.spawned = true;
  store().update(spec.id, { status: "starting", error: null, exitCode: null });
  try {
    const onEvent = handlePtyEvent(entry);
    const info = runningPtys.has(spec.id)
      ? await api.ptyAttach(spec.id, onEvent)
      : await api.ptySpawn({ ...spec, cols: term.cols, rows: term.rows }, onEvent);
    if (!info.exited) runningPtys.add(spec.id);
    store().update(spec.id, {
      status: info.exited ? "exited" : "running",
      pid: info.pid,
      exitCode: info.exitCode,
    });
    if (runningPtys.has(spec.id)) void api.ptyResize(spec.id, term.cols, term.rows);
  } catch (error) {
    entry.spawned = false;
    store().update(spec.id, { status: "error", error: errorMessage(error) });
  }
};

export const startTerminal = (spec: TerminalSpec) => {
  if (entries.has(spec.id)) return;
  const entry = createEntry(spec);
  entries.set(spec.id, entry);
  store().upsert({
    id: spec.id,
    kind: spec.kind,
    workspaceId: spec.workspaceId,
    cwd: spec.cwd,
    status: "starting",
    pid: null,
    exitCode: null,
    error: null,
    busy: false,
    attention: false,
  });
  if (runningPtys.has(spec.id)) void spawnPty(entry);
};

export const hasTerminal = (id: string) => entries.has(id);

export const fitTerminal = (id: string) => {
  const entry = entries.get(id);
  if (!entry?.opened || !entry.element.isConnected) return;
  const { clientWidth, clientHeight } = entry.element;
  if (clientWidth < 20 || clientHeight < 20) return;
  const proposed = entry.fit.proposeDimensions();
  if (!proposed || Number.isNaN(proposed.cols) || Number.isNaN(proposed.rows)) return;
  if (proposed.cols === entry.term.cols && proposed.rows === entry.term.rows) return;
  entry.quietUntil = performance.now() + 600;
  entry.fit.fit();
  if (runningPtys.has(id)) void api.ptyResize(id, entry.term.cols, entry.term.rows).catch(() => undefined);
};

export const mountTerminal = (id: string, host: HTMLElement) => {
  const entry = entries.get(id);
  if (!entry) return;
  if (entry.element.parentElement !== host) host.appendChild(entry.element);
  if (!entry.opened) {
    entry.term.open(entry.element);
    entry.opened = true;
  }
  ensureWebgl(entry);
  fitTerminal(id);
  entry.term.refresh(0, entry.term.rows - 1);
  store().update(id, { attention: false });
  if (!entry.spawned) void spawnPty(entry);
};

export const unmountTerminal = (id: string, host: HTMLElement) => {
  const entry = entries.get(id);
  if (entry && entry.element.parentElement === host) host.removeChild(entry.element);
};

export const focusTerminal = (id: string) => entries.get(id)?.term.focus();

export const pasteIntoTerminal = (id: string, text: string) => {
  const entry = entries.get(id);
  if (!entry) return;
  entry.term.paste(text);
  entry.term.focus();
};

export const clearTerminal = (id: string) => entries.get(id)?.term.clear();

export const restartTerminal = async (id: string, patch?: Partial<TerminalSpec>) => {
  const entry = entries.get(id);
  if (!entry) return;
  await api.ptyKill(id).catch(() => undefined);
  runningPtys.delete(id);
  entry.spec = { ...entry.spec, ...patch };
  entry.term.reset();
  await spawnPty(entry);
};

export const disposeTerminal = async (id: string) => {
  const entry = entries.get(id);
  runningPtys.delete(id);
  entries.delete(id);
  store().remove(id);
  if (entry) {
    window.clearTimeout(entry.idleTimer);
    releaseWebgl(entry);
    entry.term.dispose();
    entry.element.remove();
  }
  await api.ptyKill(id).catch(() => undefined);
};

useSettingsStore.subscribe((state, previous) => {
  if (state.themeId !== previous.themeId) {
    const theme = findTheme(state.themeId).terminal;
    for (const entry of entries.values()) entry.term.options.theme = theme;
  }
  if (state.fontSize === previous.fontSize) return;
  for (const [id, entry] of entries) {
    entry.term.options.fontSize = state.fontSize;
    fitTerminal(id);
  }
});
