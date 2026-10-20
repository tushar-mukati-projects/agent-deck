import { format } from "date-fns";

import { neighborAt } from "@/lib/utils";
import type { Note } from "@/types";

export interface NoteEntry extends Note {
  stored: boolean;
  dirty?: boolean;
}

const LINE_MARKER = /^(?:#+\s*|[-*+>]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/;
const HEADING = /^(#{1,6})\s/;

export const noteTitle = (text: string) => {
  for (const part of text.split("\n")) {
    const line = part.trim().replace(LINE_MARKER, "").trim();
    if (line) return line.slice(0, 80);
  }
  return "Untitled";
};

export const renameText = (text: string, name: string) => {
  const lines = text.split("\n");
  const index = lines.findIndex((line) => line.trim());
  const level = index >= 0 ? HEADING.exec(lines[index].trim())?.[1] : undefined;
  if (level) lines[index] = `${level} ${name}`;
  else lines.unshift(`# ${name}`);
  return lines.join("\n");
};

export const newNoteId = (date: Date) => format(date, "yyyy-MM-dd-HHmmss-SSS");

export const draftNote = (): NoteEntry => {
  const date = new Date();
  return {
    id: newNoteId(date),
    text: "",
    modifiedMs: date.getTime(),
    stored: false,
  };
};

export const pruneDrafts = (notes: NoteEntry[], keepId?: string | null) =>
  notes.filter((note) => note.stored || note.text || note.id === keepId);

export const withoutNote = (notes: NoteEntry[], activeId: string | null, id: string) => {
  const index = notes.findIndex((note) => note.id === id);
  const rest = notes.filter((note) => note.id !== id);
  const remaining = rest.length ? rest : [draftNote()];
  const nextActive =
    activeId === id || !remaining.some((note) => note.id === activeId)
      ? (neighborAt(remaining, index)?.id ?? null)
      : activeId;
  return { notes: remaining, activeId: nextActive };
};
