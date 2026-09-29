import type { Terminal } from "@xterm/xterm";

import { useTerminalStore } from "@/stores/terminal-store";
import type { TerminalKind } from "@/types";

const IDLE_AFTER_MS = 1600;
const ECHO_WINDOW_MS = 400;
const RESIZE_WINDOW_MS = 600;
const MIN_BUSY_FOR_ALERT_MS = 3000;
const TERMINAL_REPORT = /^\x1b\[(?:[IO]|<[\d;]+[Mm]|M[\s\S]{3})$/;
const CONTROL = /[\x00-\x1f\x7f]/;
const PASTE_START = "\x1b[200~";
const CLEARS_DRAFT = new Set(["\r", "\x03", "\x15"]);
const ERASES = new Set(["\x7f", "\b"]);
const INPUT_PROMPT_PATTERN =
  /Do you want to|Would you like to|\(y\/n\)|\[y\/N\]|❯ 1\. Yes|Yes, proceed|Enter to confirm|Esc to cancel|Allow this/i;

export interface IdleEvent {
  terminalId: string;
  workspaceId: string;
  cwd: string;
  busyMs: number;
  needsInput: boolean;
  visible: boolean;
}

export interface Activity {
  busy: boolean;
  busySince: number;
  quietUntil: number;
  idleTimer: number | undefined;
  typedAt: number;
  draft: number;
}

interface ActivityOwner {
  spec: { id: string; kind: TerminalKind; workspaceId: string; root: string };
  term: Terminal;
  element: HTMLElement;
  activity: Activity;
}

const listeners = new Set<(event: IdleEvent) => void>();

export const onAgentIdle = (listener: (event: IdleEvent) => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const createActivity = (): Activity => ({
  busy: false,
  busySince: 0,
  quietUntil: 0,
  idleTimer: undefined,
  typedAt: 0,
  draft: 0,
});

const update = (id: string, patch: { busy?: boolean; attention?: boolean }) =>
  useTerminalStore.getState().update(id, patch);

const screenTail = (term: Terminal, lines: number) => {
  const buffer = term.buffer.active;
  const end = buffer.baseY + buffer.cursorY;
  const rows: string[] = [];
  for (let y = Math.max(0, end - lines); y <= end; y += 1)
    rows.push(buffer.getLine(y)?.translateToString(true) ?? "");
  return rows.join("\n");
};

const nextDraft = (draft: number, data: string) => {
  if (CLEARS_DRAFT.has(data)) return 0;
  if (ERASES.has(data)) return Math.max(0, draft - 1);
  if (data.startsWith(PASTE_START)) return draft + 1;
  return CONTROL.test(data) ? draft : draft + [...data].length;
};

export const noteInput = (owner: ActivityOwner, data: string) => {
  const { activity } = owner;
  activity.quietUntil = performance.now() + ECHO_WINDOW_MS;
  if (TERMINAL_REPORT.test(data)) return;
  activity.typedAt = Date.now();
  activity.draft = nextDraft(activity.draft, data);
};

export const noteResize = (owner: ActivityOwner) => {
  owner.activity.quietUntil = performance.now() + RESIZE_WINDOW_MS;
};

const settle = (owner: ActivityOwner) => {
  const { activity, spec } = owner;
  activity.busy = false;
  const busyMs = performance.now() - activity.busySince - IDLE_AFTER_MS;
  const visible = owner.element.isConnected && document.hasFocus();
  const meaningful = spec.kind === "agent" && busyMs >= MIN_BUSY_FOR_ALERT_MS;
  update(spec.id, { busy: false, ...(meaningful && !visible ? { attention: true } : {}) });
  if (!meaningful) return;
  const event: IdleEvent = {
    terminalId: spec.id,
    workspaceId: spec.workspaceId,
    cwd: spec.root,
    busyMs,
    needsInput: INPUT_PROMPT_PATTERN.test(screenTail(owner.term, 18)),
    visible,
  };
  listeners.forEach((listener) => listener(event));
};

export const noteOutput = (owner: ActivityOwner) => {
  const { activity } = owner;
  if (performance.now() < activity.quietUntil) return;
  if (!activity.busy) {
    activity.busy = true;
    activity.busySince = performance.now();
    update(owner.spec.id, { busy: true });
  }
  window.clearTimeout(activity.idleTimer);
  activity.idleTimer = window.setTimeout(() => settle(owner), IDLE_AFTER_MS);
};

export const resetActivity = (owner: Pick<ActivityOwner, "spec" | "activity">) => {
  window.clearTimeout(owner.activity.idleTimer);
  owner.activity.busy = false;
  owner.activity.draft = 0;
  update(owner.spec.id, { busy: false, attention: false });
};
