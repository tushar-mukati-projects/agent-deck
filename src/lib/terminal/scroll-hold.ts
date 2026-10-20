import type { Terminal } from "@xterm/xterm";

import {
  captureAnchor,
  locateAnchor,
  type Rows,
  type ScrollAnchor,
} from "@/lib/terminal/scroll-anchor";

const FIRST_OUTPUT_MS = 1000;
const QUIET_OUTPUT_MS = 300;
const MAX_HOLD_MS = 3000;
const USER_SCROLL_EVENTS = ["wheel", "mousedown", "keydown"] as const;

export type ScrollHold = {
  anchor: ScrollAnchor;
  release: () => void;
  timer?: number;
  writes?: { dispose: () => void };
};

type HeldTerminal = {
  term: Terminal;
  element: HTMLElement;
  scrollHold: ScrollHold | null;
};

const rowsOf = (term: Terminal): Rows => {
  const buffer = term.buffer.active;
  return {
    count: buffer.length,
    text: (row) => buffer.getLine(row)?.translateToString(true) ?? "",
  };
};

export const scrollToAnchor = (term: Terminal, anchor: ScrollAnchor) =>
  term.scrollToLine(locateAnchor(rowsOf(term), anchor, term.buffer.active.baseY));

export const holdScroll = (entry: HeldTerminal) => {
  const { viewportY, baseY } = entry.term.buffer.active;
  if (entry.scrollHold || viewportY >= baseY) return;
  const release = () => {
    window.clearTimeout(hold.timer);
    hold.writes?.dispose();
    USER_SCROLL_EVENTS.forEach((type) => entry.element.removeEventListener(type, release, true));
    if (entry.scrollHold === hold) entry.scrollHold = null;
  };
  const hold: ScrollHold = { anchor: captureAnchor(rowsOf(entry.term), viewportY, baseY), release };
  USER_SCROLL_EVENTS.forEach((type) => entry.element.addEventListener(type, release, true));
  entry.scrollHold = hold;
};

export const restoreScrollAfterOutput = (entry: HeldTerminal, redrawing: boolean) => {
  const hold = entry.scrollHold;
  if (!hold) return;
  window.clearTimeout(hold.timer);
  hold.writes?.dispose();
  hold.writes = undefined;
  const finish = () => {
    if (entry.scrollHold !== hold) return;
    hold.release();
    scrollToAnchor(entry.term, hold.anchor);
  };
  if (!redrawing) return finish();
  const deadline = performance.now() + MAX_HOLD_MS;
  const finishAfter = (ms: number) => {
    window.clearTimeout(hold.timer);
    hold.timer = window.setTimeout(finish, Math.min(ms, Math.max(0, deadline - performance.now())));
  };
  hold.writes = entry.term.onWriteParsed(() => finishAfter(QUIET_OUTPUT_MS));
  finishAfter(FIRST_OUTPUT_MS);
};
