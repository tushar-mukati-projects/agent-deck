import type { Terminal } from "@xterm/xterm";

import { copyText } from "@/lib/tauri/system";
import type { TerminalKind } from "@/types";

export const DECK_PATH_MIME = "application/x-deck-path";

interface InputOwner {
  kind: TerminalKind;
  term: Terminal;
  send: (data: string) => void;
  onFind: () => void;
}

const pasteFromClipboard = async (term: Terminal) => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) term.paste(text);
  } catch {
    return;
  }
};

export const createKeyHandler = (owner: InputOwner) => (event: KeyboardEvent) => {
  if (event.type !== "keydown") return true;
  const { term } = owner;
  const key = event.key.toLowerCase();
  const ctrlOnly = event.ctrlKey && !event.altKey && !event.metaKey;

  if (ctrlOnly && !event.shiftKey && key === "c" && term.hasSelection()) {
    void copyText(term.getSelection());
    term.clearSelection();
    event.preventDefault();
    return false;
  }
  if (ctrlOnly && event.shiftKey && key === "c") {
    if (term.hasSelection()) void copyText(term.getSelection());
    event.preventDefault();
    return false;
  }
  if (ctrlOnly && !event.shiftKey && key === "v") return false;
  if (ctrlOnly && !event.shiftKey && key === "f") {
    owner.onFind();
    event.preventDefault();
    return false;
  }
  if (
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    key === "enter" &&
    owner.kind === "agent"
  ) {
    owner.send("\x1b\r");
    event.preventDefault();
    return false;
  }
  return true;
};

export const createPasteHandler = (owner: InputOwner) => (event: ClipboardEvent) => {
  const data = event.clipboardData;
  if (!data || data.getData("text/plain") || owner.kind !== "agent") return;
  if (!Array.from(data.items).some((item) => item.type.startsWith("image/"))) return;
  event.preventDefault();
  event.stopPropagation();
  owner.send("\x1bv");
};

export const createContextMenuHandler = (owner: InputOwner) => (event: MouseEvent) => {
  event.preventDefault();
  if (owner.term.hasSelection()) {
    void copyText(owner.term.getSelection());
    owner.term.clearSelection();
  } else {
    void pasteFromClipboard(owner.term);
  }
};
