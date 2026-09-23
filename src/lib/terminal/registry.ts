import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";

import { api } from "@/lib/tauri/commands";
import { openExternal } from "@/lib/tauri/system";
import {
  createActivity,
  noteInput,
  noteOutput,
  noteResize,
  resetActivity,
  type Activity,
} from "@/lib/terminal/activity";
import {
  createContextMenuHandler,
  createKeyHandler,
  createPasteHandler,
} from "@/lib/terminal/input";
import { registerPathLinks, type PathLinkTarget } from "@/lib/terminal/links";
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
  root: string;
  program: string;
  args: string[];
  initialInput?: string;
}

interface Entry {
  spec: TerminalSpec;
  id: string;
  kind: TerminalKind;
  workspaceId: string;
  cwd: string;
  term: Terminal;
  fit: FitAddon;
  search: SearchAddon;
  element: HTMLDivElement;
  webgl: WebglAddon | null;
  opened: boolean;
  spawned: boolean;
  generation: number;
  focusOnMount: boolean;
  activity: Activity;
}

const MAX_WEBGL_CONTEXTS = 6;
const SEARCH_DECORATIONS = {
  matchBackground: "#88888855",
  activeMatchBackground: "#e27a55aa",
  matchOverviewRuler: "#888888",
  activeMatchColorOverviewRuler: "#e27a55",
};

const entries = new Map<string, Entry>();
const webglOrder: string[] = [];
const findListeners = new Set<(terminalId: string) => void>();
let pathLinkHandler: ((workspaceId: string, target: PathLinkTarget) => void) | null = null;
let runningPtys = new Set<string>();

const store = () => useTerminalStore.getState();

export const setRunningPtys = (ids: string[]) => {
  runningPtys = new Set(ids);
};

export const isPtyRunning = (id: string) => runningPtys.has(id);

export const onFindRequest = (listener: (terminalId: string) => void) => {
  findListeners.add(listener);
  return () => void findListeners.delete(listener);
};

export const setPathLinkHandler = (
  handler: (workspaceId: string, target: PathLinkTarget) => void,
) => {
  pathLinkHandler = handler;
};

const isCurrent = (entry: Entry, generation: number) =>
  entries.get(entry.id) === entry && entry.generation === generation;

const releaseWebgl = (entry: Entry) => {
  entry.webgl?.dispose();
  entry.webgl = null;
  const index = webglOrder.indexOf(entry.id);
  if (index >= 0) webglOrder.splice(index, 1);
};

const ensureWebgl = (entry: Entry) => {
  const index = webglOrder.indexOf(entry.id);
  if (index >= 0) webglOrder.splice(index, 1);
  webglOrder.push(entry.id);
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

const send = (entry: Entry, data: string) => {
  noteInput(entry);
  api.ptyWrite(entry.id, data).catch(() => undefined);
};

const handlePtyEvent = (entry: Entry, generation: number) => (event: PtyEvent) => {
  if (!isCurrent(entry, generation)) return;
  if (event.type === "data") {
    entry.term.write(event.data);
    noteOutput(entry);
    return;
  }
  resetActivity(entry);
  runningPtys.delete(entry.id);
  store().update(entry.id, { status: "exited", exitCode: event.code });
};

const createEntry = (spec: TerminalSpec): Entry => {
  const { fontSize, themeId } = useSettingsStore.getState();
  const term = new Terminal({
    allowProposedApi: true,
    fontFamily: '"JetBrains Mono Variable", "Cascadia Code", Consolas, monospace',
    fontSize,
    lineHeight: 1.18,
    fontWeight: 400,
    fontWeightBold: 550,
    cursorBlink: true,
    cursorStyle: "bar",
    cursorWidth: 2,
    scrollback: 10_000,
    smoothScrollDuration: 90,
    minimumContrastRatio: 1,
    drawBoldTextInBrightColors: false,
    theme: findTheme(themeId).terminal,
  });
  const fit = new FitAddon();
  const search = new SearchAddon();
  const unicode = new Unicode11Addon();
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(unicode);
  term.loadAddon(new WebLinksAddon((_event, uri) => void openExternal(uri)));
  term.unicode.activeVersion = "11";

  const element = document.createElement("div");
  element.className = "h-full w-full";
  element.dataset.terminalKind = spec.kind;

  const entry: Entry = {
    spec,
    id: spec.id,
    kind: spec.kind,
    workspaceId: spec.workspaceId,
    cwd: spec.root,
    term,
    fit,
    search,
    element,
    webgl: null,
    opened: false,
    spawned: false,
    generation: 0,
    focusOnMount: false,
    activity: createActivity(),
  };

  const owner = {
    kind: spec.kind,
    term,
    send: (data: string) => send(entry, data),
    onFind: () => findListeners.forEach((listener) => listener(entry.id)),
  };
  term.attachCustomKeyEventHandler(createKeyHandler(owner));
  term.onData((data) => send(entry, data));
  registerPathLinks(
    term,
    () => entry.spec.root,
    (target) => pathLinkHandler?.(entry.workspaceId, target),
  );
  element.addEventListener("paste", createPasteHandler(owner), true);
  element.addEventListener("contextmenu", createContextMenuHandler(owner));
  return entry;
};

const spawnPty = async (entry: Entry) => {
  const generation = ++entry.generation;
  const { spec, term } = entry;
  const attaching = runningPtys.has(spec.id);
  entry.spawned = true;
  store().update(spec.id, { status: "starting", error: null, exitCode: null });
  try {
    const onEvent = handlePtyEvent(entry, generation);
    const info = attaching
      ? await api.ptyAttach(spec.id, onEvent)
      : await api.ptySpawn(
          {
            id: spec.id,
            cwd: spec.cwd,
            program: spec.program,
            args: spec.args,
            cols: term.cols,
            rows: term.rows,
          },
          onEvent,
        );
    if (!isCurrent(entry, generation)) {
      void api.ptyKill(spec.id).catch(() => undefined);
      return;
    }
    if (!info.exited) runningPtys.add(spec.id);
    store().update(spec.id, {
      status: info.exited ? "exited" : "running",
      pid: info.pid,
      exitCode: info.exitCode,
    });
    if (info.exited) return;
    void api.ptyResize(spec.id, term.cols, term.rows).catch(() => undefined);
    if (!attaching && spec.initialInput) send(entry, `${spec.initialInput}\r`);
  } catch (error) {
    if (!isCurrent(entry, generation)) return;
    entry.spawned = false;
    store().update(spec.id, { status: "error", error: errorMessage(error) });
  }
};

export const startTerminal = (spec: TerminalSpec, options?: { focus?: boolean }) => {
  if (entries.has(spec.id)) return;
  const entry = createEntry(spec);
  entry.focusOnMount = !!options?.focus;
  entries.set(spec.id, entry);
  store().upsert({
    id: spec.id,
    kind: spec.kind,
    workspaceId: spec.workspaceId,
    cwd: spec.root,
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
  if (entry.element.clientWidth < 20 || entry.element.clientHeight < 20) return;
  const proposed = entry.fit.proposeDimensions();
  if (!proposed || Number.isNaN(proposed.cols) || Number.isNaN(proposed.rows)) return;
  if (proposed.cols === entry.term.cols && proposed.rows === entry.term.rows) return;
  noteResize(entry);
  entry.fit.fit();
  if (runningPtys.has(id))
    void api.ptyResize(id, entry.term.cols, entry.term.rows).catch(() => undefined);
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
  if (entry.focusOnMount) {
    entry.focusOnMount = false;
    requestAnimationFrame(() => entry.term.focus());
  }
  if (!entry.spawned) void spawnPty(entry);
};

export const unmountTerminal = (id: string, host: HTMLElement) => {
  const entry = entries.get(id);
  if (entry && entry.element.parentElement === host) host.removeChild(entry.element);
};

export const focusTerminal = (id: string) => entries.get(id)?.term.focus();

export const requestFocus = (id: string) => {
  const entry = entries.get(id);
  if (!entry) return;
  if (entry.element.isConnected) entry.term.focus();
  else entry.focusOnMount = true;
};

export const pasteIntoTerminal = (id: string, text: string) => {
  const entry = entries.get(id);
  if (!entry) return;
  entry.term.paste(text);
  entry.term.focus();
};

export const clearTerminal = (id: string) => entries.get(id)?.term.clear();

export const findInTerminal = (id: string, query: string, direction: "next" | "previous") => {
  const search = entries.get(id)?.search;
  if (!search || !query) return false;
  const options = { decorations: SEARCH_DECORATIONS, caseSensitive: false };
  return direction === "next"
    ? search.findNext(query, options)
    : search.findPrevious(query, options);
};

export const clearTerminalSearch = (id: string) => {
  const entry = entries.get(id);
  entry?.search.clearDecorations();
  entry?.term.clearSelection();
};

export const restartTerminal = async (id: string, spec?: TerminalSpec) => {
  const entry = entries.get(id);
  if (!entry) return;
  entry.generation += 1;
  resetActivity(entry);
  runningPtys.delete(id);
  await api.ptyKill(id).catch(() => undefined);
  if (spec) entry.spec = spec;
  entry.term.reset();
  await spawnPty(entry);
};

export const disposeTerminal = async (id: string) => {
  const entry = entries.get(id);
  runningPtys.delete(id);
  if (entry) {
    entry.generation += 1;
    window.clearTimeout(entry.activity.idleTimer);
    releaseWebgl(entry);
    entry.term.dispose();
    entry.element.remove();
  }
  entries.delete(id);
  store().remove(id);
  await api.ptyKill(id).catch(() => undefined);
};

useSettingsStore.subscribe((state, previous) => {
  if (state.themeId !== previous.themeId) {
    const theme = findTheme(state.themeId).terminal;
    for (const entry of entries.values()) entry.term.options.theme = theme;
  }
  if (state.fontSize !== previous.fontSize) {
    for (const [id, entry] of entries) {
      entry.term.options.fontSize = state.fontSize;
      fitTerminal(id);
    }
  }
});
