import { create } from "zustand";

import type { NoteEntry } from "@/lib/notes";

interface NotesState {
  notes: NoteEntry[];
  activeId: string | null;
  loaded: boolean;
}

export const useNotesStore = create<NotesState>(() => ({
  notes: [],
  activeId: null,
  loaded: false,
}));
