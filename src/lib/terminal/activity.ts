import type { Terminal } from "@xterm/xterm";

import { useTerminalStore } from "@/stores/terminal-store";
import type { TerminalKind } from "@/types";

const IDLE_AFTER_MS = 1600;
const ECHO_WINDOW_MS = 400;
const RESIZE_WINDOW_MS = 600;
export const MIN_BUSY_FOR_ALERT_MS = 3000;
const INPUT_PROMPT_PATTERN =
  /Do you want to|Would you like to|\(y\/n\)|❯ 1\. Yes|Enter to confirm|Esc to cancel|Allow this/i;

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
}

interface ActivityOwner {
  id: string;
  kind: TerminalKind;
  workspaceId: string;
  cwd: string;
  term: Terminal;
  element: HTMLElement;
  activity: Activity;
}

const listeners = new Set<(event: IdleEvent) => void>();

export const onClaudeIdle = (listener: (event: IdleEvent) => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const createActivity = (): Activity => ({
  busy: false,
  busySince: 0,
  quietUntil: 0,
  idleTimer: undefined,
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

export const noteInput = (owner: ActivityOwner) => {
  owner.activity.quietUntil = performance.now() + ECHO_WINDOW_MS;
};

export const noteResize = (owner: ActivityOwner) => {
  owner.activity.quietUntil = performance.now() + RESIZE_WINDOW_MS;
};

const settle = (owner: ActivityOwner) => {
  const { activity } = owner;
  activity.busy = false;
  const busyMs = performance.now() - activity.busySince - IDLE_AFTER_MS;
  const visible = owner.element.isConnected && document.hasFocus();
  const meaningful = owner.kind === "claude" && busyMs >= MIN_BUSY_FOR_ALERT_MS;
  update(owner.id, { busy: false, ...(meaningful && !visible ? { attention: true } : {}) });
  if (!meaningful) return;
  const event: IdleEvent = {
    terminalId: owner.id,
    workspaceId: owner.workspaceId,
    cwd: owner.cwd,
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
    update(owner.id, { busy: true });
  }
  window.clearTimeout(activity.idleTimer);
  activity.idleTimer = window.setTimeout(() => settle(owner), IDLE_AFTER_MS);
};

export const resetActivity = (owner: Pick<ActivityOwner, "id" | "activity">) => {
  window.clearTimeout(owner.activity.idleTimer);
  owner.activity.busy = false;
  update(owner.id, { busy: false, attention: false });
};
