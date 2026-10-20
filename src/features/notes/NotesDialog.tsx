import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen, Plus, TextCursorInput, Trash2, X } from "lucide-react";

import {
  closeNotes,
  deleteNote,
  editNote,
  flushNotes,
  loadNotes,
  newNote,
  openNotesFolder,
  renameNote,
  selectNote,
  useNotesStore,
} from "@/actions/notes";
import { Dialog } from "@/components/ui/dialog";
import { LoadingState } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { TimeAgo } from "@/components/ui/time-ago";
import { CodeView } from "@/features/viewer/CodeView";
import { noteTitle, type NoteEntry } from "@/lib/notes";
import { shortcutLabel } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

const NameInput = ({ title, onDone }: { title: string; onDone: (name: string | null) => void }) => {
  const [value, setValue] = useState(title);
  const cancelled = useRef(false);
  return (
    <input
      autoFocus
      aria-label="Note name"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => !cancelled.current && onDone(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key !== "Escape") return;
        cancelled.current = true;
        onDone(null);
      }}
      className="h-7 min-w-0 flex-1 rounded-md border border-border-strong bg-panel px-2 text-[13px] font-medium text-fg outline-none focus:border-accent"
    />
  );
};

const NoteRow = memo(
  ({
    note,
    active,
    onSelect,
    onRename,
  }: {
    note: NoteEntry;
    active: boolean;
    onSelect: (id: string) => void;
    onRename: () => void;
  }) => (
    <button
      type="button"
      title="Double-click to rename"
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(note.id)}
      onDoubleClick={onRename}
      className={cn(
        "flex w-full flex-col rounded-md px-2.5 py-1.5 text-left",
        active ? "bg-active" : "hover:bg-hover",
      )}
    >
      <span className="truncate text-[12.5px] text-fg/90">{noteTitle(note.text)}</span>
      <TimeAgo ms={note.modifiedMs} className="text-[10.5px] text-faint" />
    </button>
  ),
);
NoteRow.displayName = "NoteRow";

export const NotesDialog = () => {
  const open = useUiStore((s) => s.notesOpen);
  const notes = useNotesStore((s) => s.notes);
  const activeId = useNotesStore((s) => s.activeId);
  const loaded = useNotesStore((s) => s.loaded);
  const [renaming, setRenaming] = useState(false);
  const active = loaded ? (notes.find((note) => note.id === activeId) ?? null) : null;
  const startRename = useCallback(() => setRenaming(true), []);

  useEffect(() => {
    if (open) void loadNotes();
    else setRenaming(false);
  }, [open]);

  const finishRename = (name: string | null) => {
    setRenaming(false);
    if (name !== null) renameNote(name);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        if (renaming) setRenaming(false);
        else closeNotes();
      }}
      title="Notes"
      description="Quick notes, saved as you type."
      hideHeader
      className="top-[5%] w-[min(1080px,calc(100vw-48px))] overflow-hidden"
    >
      <div className="flex h-[min(760px,85vh)]">
        <nav
          aria-label="Your notes"
          className="flex w-[220px] shrink-0 flex-col border-r border-border bg-panel"
        >
          <div className="flex items-center justify-between px-3 pt-3 pb-2">
            <p className="pl-1 text-[15px] font-semibold text-fg">Notes</p>
            <IconButton label="New note" onClick={newNote}>
              <Plus />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
            {loaded &&
              notes.map((note) => (
                <NoteRow
                  key={note.id}
                  note={note}
                  active={note.id === activeId}
                  onSelect={selectNote}
                  onRename={startRename}
                />
              ))}
          </div>
          <p className="px-4 pb-3 text-[11px] leading-snug text-faint">Saved as you type.</p>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col bg-bg">
          <header className="flex h-11 shrink-0 items-center gap-0.5 border-b border-border pr-2 pl-4">
            {active && renaming ? (
              <NameInput key={active.id} title={noteTitle(active.text)} onDone={finishRename} />
            ) : (
              <h2 className="min-w-0 flex-1 truncate">
                <button
                  type="button"
                  title="Rename"
                  disabled={!active}
                  onClick={() => setRenaming(true)}
                  className="max-w-full truncate rounded-md px-1 text-left text-[13px] font-medium text-fg hover:bg-hover"
                >
                  {active ? noteTitle(active.text) : "Notes"}
                </button>
              </h2>
            )}
            <IconButton label="Rename note" disabled={!active} onClick={() => setRenaming(true)}>
              <TextCursorInput />
            </IconButton>
            <IconButton label="Open notes folder" onClick={() => void openNotesFolder()}>
              <FolderOpen />
            </IconButton>
            <IconButton
              label="Delete note"
              disabled={!active}
              onClick={() => active && void deleteNote(active.id)}
            >
              <Trash2 />
            </IconButton>
            <IconButton label="Close" shortcut={shortcutLabel("notes")} onClick={closeNotes}>
              <X />
            </IconButton>
          </header>
          <div className="min-h-0 flex-1">
            {active ? (
              <CodeView
                key={active.id}
                path={`${active.id}.md`}
                value={active.text}
                editable
                plain
                placeholder="Write anything…"
                onChange={editNote}
                onSave={flushNotes}
              />
            ) : (
              <LoadingState className="h-full" />
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
};
