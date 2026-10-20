import { toast } from "sonner";

import {
  draftNote,
  noteTitle,
  pruneDrafts,
  renameText,
  withoutNote,
  type NoteEntry,
} from "@/lib/notes";
import { api } from "@/lib/tauri/commands";
import { failedTo } from "@/lib/utils";
import { useNotesStore } from "@/stores/notes-store";
import { useUiStore } from "@/stores/ui-store";

const SAVE_DELAY_MS = 400;
let timer: number | undefined;
let pendingId: string | null = null;
let queue: Promise<void> = Promise.resolve();

const enqueue = (work: () => Promise<void>, action: string) => {
  queue = queue.then(work).catch((error) => void toast.error(failedTo(action, error)));
  return queue;
};

const patch = (id: string, update: Partial<NoteEntry>) =>
  useNotesStore.setState((s) => ({
    notes: s.notes.map((note) => (note.id === id ? { ...note, ...update } : note)),
  }));

const save = (id: string) => {
  const note = useNotesStore.getState().notes.find((n) => n.id === id);
  if (!note || (!note.stored && !note.text)) return queue;
  const { text } = note;
  return enqueue(async () => {
    const modifiedMs = await api.saveNote(id, text);
    const current = useNotesStore.getState().notes.find((n) => n.id === id);
    patch(id, { stored: true, modifiedMs, dirty: current?.text !== text });
  }, "save the note");
};

const cancelPending = () => {
  window.clearTimeout(timer);
  timer = undefined;
  const id = pendingId;
  pendingId = null;
  return id;
};

export const flushNotes = () => {
  const id = cancelPending();
  return id ? save(id) : queue;
};

const showNotes = (available: NoteEntry[]) => {
  const notes = available.length ? available : [draftNote()];
  const { activeId } = useNotesStore.getState();
  const keep = notes.some((note) => note.id === activeId) ? activeId : notes[0].id;
  useNotesStore.setState({ notes, activeId: keep, loaded: true });
};

export const loadNotes = async () => {
  useNotesStore.setState({ loaded: false });
  await flushNotes();
  try {
    const stored = (await api.listNotes()).map((note) => ({ ...note, stored: true, dirty: false }));
    const unsaved = useNotesStore
      .getState()
      .notes.filter((note) => note.dirty || (!note.stored && note.text));
    const merged = [...unsaved, ...stored.filter((note) => !unsaved.some((u) => u.id === note.id))];
    showNotes(merged);
  } catch (error) {
    toast.error(failedTo("load notes", error));
    showNotes(useNotesStore.getState().notes);
  }
};

export const editNote = (text: string) => {
  const { activeId } = useNotesStore.getState();
  if (!activeId) return;
  patch(activeId, { text, modifiedMs: Date.now(), dirty: true });
  if (pendingId !== activeId) void flushNotes();
  pendingId = activeId;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void flushNotes(), SAVE_DELAY_MS);
};

export const renameNote = (name: string) => {
  const title = name.replace(/\s+/g, " ").trim();
  const { notes, activeId } = useNotesStore.getState();
  const note = notes.find((n) => n.id === activeId);
  if (!note || !title || title === noteTitle(note.text)) return;
  editNote(renameText(note.text, title));
  void flushNotes();
};

export const selectNote = (id: string) => {
  void flushNotes();
  useNotesStore.setState((s) => ({ notes: pruneDrafts(s.notes, id), activeId: id }));
};

export const newNote = () => {
  void flushNotes();
  const note = draftNote();
  useNotesStore.setState((s) => ({ notes: [note, ...pruneDrafts(s.notes)], activeId: note.id }));
};

export const deleteNote = async (id: string) => {
  const note = useNotesStore.getState().notes.find((n) => n.id === id);
  if (!note) return;
  const confirmed =
    !note.text.trim() ||
    (await useUiStore.getState().askConfirm({
      title: `Delete "${noteTitle(note.text)}"?`,
      description: "The note moves to the Recycle Bin.",
      confirmLabel: "Delete",
      destructive: true,
    }));
  if (!confirmed) return;
  if (pendingId === id) cancelPending();
  useNotesStore.setState((s) => withoutNote(s.notes, s.activeId, id));
  await enqueue(() => api.deleteNote(id), "delete the note");
};

export const openNotesFolder = () =>
  enqueue(async () => api.openPath(await api.notesFolder()), "open the notes folder");

export const closeNotes = () => {
  void flushNotes();
  useNotesStore.setState((s) => ({ notes: pruneDrafts(s.notes), loaded: false }));
  useUiStore.getState().setNotesOpen(false);
};

export const toggleNotes = () => {
  if (useUiStore.getState().notesOpen) closeNotes();
  else useUiStore.getState().setNotesOpen(true);
};
