import { describe, expect, it } from "vitest";

import {
  draftNote,
  newNoteId,
  noteTitle,
  pruneDrafts,
  renameText,
  withoutNote,
  type NoteEntry,
} from "@/lib/notes";

const note = (id: string, text = id, stored = true): NoteEntry => ({
  id,
  text,
  modifiedMs: 0,
  stored,
});

describe("noteTitle", () => {
  it("uses the first non-empty line without heading marks", () => {
    expect(noteTitle("\n\n## Groceries \nmilk")).toBe("Groceries");
  });

  it("falls back to Untitled for blank notes", () => {
    expect(noteTitle("  \n\n")).toBe("Untitled");
  });

  it("drops list, quote and checkbox markers", () => {
    expect(noteTitle("- HI\n\n- w")).toBe("HI");
    expect(noteTitle("  * [ ] buy milk")).toBe("buy milk");
    expect(noteTitle("1. first")).toBe("first");
    expect(noteTitle("> quoted")).toBe("quoted");
  });

  it("caps long titles", () => {
    expect(noteTitle("x".repeat(200))).toHaveLength(80);
  });
});

describe("renameText", () => {
  it("adds a heading above notes that have none", () => {
    const renamed = renameText("- HI\n\n- w", "Shopping");
    expect(renamed).toBe("# Shopping\n- HI\n\n- w");
    expect(noteTitle(renamed)).toBe("Shopping");
  });

  it("replaces the top heading and keeps its level", () => {
    expect(renameText("\n## Old\nbody", "New")).toBe("\n## New\nbody");
  });

  it("names an empty note", () => {
    expect(renameText("", "Ideas")).toBe("# Ideas\n");
  });

  it("does not treat a hashtag as a heading", () => {
    expect(renameText("#todo later", "Plan")).toBe("# Plan\n#todo later");
  });
});

describe("note ids", () => {
  it("are readable and safe as file names", () => {
    const id = newNoteId(new Date(2026, 9, 8, 23, 17, 9, 42));
    expect(id).toBe("2026-10-08-231709-042");
    expect(id).toMatch(/^[A-Za-z0-9-]+$/);
  });

  it("start drafts empty and unsaved", () => {
    expect(draftNote()).toMatchObject({ text: "", stored: false });
  });
});

describe("pruneDrafts", () => {
  it("drops empty unsaved notes except the one being kept", () => {
    const notes = [
      note("a", "", false),
      note("b", "", false),
      note("c", ""),
      note("d", "x", false),
    ];
    expect(pruneDrafts(notes, "b").map((n) => n.id)).toEqual(["b", "c", "d"]);
  });
});

describe("withoutNote", () => {
  it("selects the note that took the deleted one's place", () => {
    const result = withoutNote([note("a"), note("b"), note("c")], "b", "b");
    expect(result.notes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(result.activeId).toBe("c");
  });

  it("selects the previous note when the last one is deleted", () => {
    expect(withoutNote([note("a"), note("b")], "b", "b").activeId).toBe("a");
  });

  it("keeps the active note when another one is deleted", () => {
    expect(withoutNote([note("a"), note("b")], "a", "b").activeId).toBe("a");
  });

  it("starts a fresh draft when nothing is left", () => {
    const result = withoutNote([note("a")], "a", "a");
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0].stored).toBe(false);
    expect(result.activeId).toBe(result.notes[0].id);
  });
});
