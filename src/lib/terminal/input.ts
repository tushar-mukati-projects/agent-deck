import type { Terminal } from "@xterm/xterm";

import { CLAUDE, CODEX } from "@/lib/agents/registry";
import { copyText } from "@/lib/tauri/system";
import type { AgentId } from "@/types";

export const DECK_PATH_MIME = "application/x-deck-path";

interface InputOwner {
  agent: AgentId | null;
  term: Terminal;
  send: (data: string) => void;
  onFind: () => void;
}

const NEWLINE_KEY: Record<string, string> = { [CLAUDE]: "\x1b\r", [CODEX]: "\n" };
const IMAGE_PASTE_KEY: Record<string, string> = { [CLAUDE]: "\x1bv", [CODEX]: "\x16" };

const keyFor = (keys: Record<string, string>, agent: AgentId | null) =>
  agent ? keys[agent] : undefined;

const pasteFromClipboard = async (owner: InputOwner) => {
  const text = await navigator.clipboard.readText().catch(() => "");
  const imageKey = keyFor(IMAGE_PASTE_KEY, owner.agent);
  if (text) owner.term.paste(text);
  else if (imageKey) owner.send(imageKey);
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
  if (ctrlOnly && event.shiftKey && key === "v") {
    void pasteFromClipboard(owner);
    event.preventDefault();
    return false;
  }
  if (ctrlOnly && !event.shiftKey && key === "f") {
    owner.onFind();
    event.preventDefault();
    return false;
  }
  const newline = keyFor(NEWLINE_KEY, owner.agent);
  if (event.shiftKey && !event.ctrlKey && !event.altKey && key === "enter" && newline) {
    owner.send(newline);
    event.preventDefault();
    return false;
  }
  return true;
};

export const createPasteHandler = (owner: InputOwner) => (event: ClipboardEvent) => {
  const data = event.clipboardData;
  const imageKey = keyFor(IMAGE_PASTE_KEY, owner.agent);
  if (!data || data.getData("text/plain") || !imageKey) return;
  if (!Array.from(data.items).some((item) => item.type.startsWith("image/"))) return;
  event.preventDefault();
  event.stopPropagation();
  owner.send(imageKey);
};

export const createContextMenuHandler = (owner: InputOwner) => (event: MouseEvent) => {
  event.preventDefault();
  if (owner.term.hasSelection()) {
    void copyText(owner.term.getSelection());
    owner.term.clearSelection();
  } else {
    void pasteFromClipboard(owner);
  }
};
