import { describe, expect, it } from "vitest";

import { carryOverStorage } from "./legacy-storage";

const memoryStorage = (entries: Record<string, string>): Storage => {
  const data = new Map(Object.entries(entries));
  return {
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
    clear: () => data.clear(),
  };
};

const contents = (storage: Storage) =>
  Object.fromEntries(
    Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index) ?? "";
      return [key, storage.getItem(key)];
    }),
  );

describe("carryOverStorage", () => {
  it("moves the old app's keys to the new names", () => {
    const storage = memoryStorage({
      "claude-deck-settings": "s",
      "claude-deck-workspaces": "w",
      "claude-deck:sql:pg": "select 1",
      other: "x",
    });
    carryOverStorage(storage);
    expect(contents(storage)).toEqual({
      other: "x",
      "agent-deck-settings": "s",
      "agent-deck-workspaces": "w",
      "agent-deck:sql:pg": "select 1",
    });
  });

  it("keeps values already saved under the new names", () => {
    const storage = memoryStorage({ "claude-deck-ui": "old", "agent-deck-ui": "new" });
    carryOverStorage(storage);
    expect(contents(storage)).toEqual({ "agent-deck-ui": "new" });
  });
});
