const OLD_PREFIX = "claude-deck";
const NEW_PREFIX = "agent-deck";

export const carryOverStorage = (storage: Storage) => {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const key of keys) {
    if (!key?.startsWith(OLD_PREFIX)) continue;
    const value = storage.getItem(key);
    const renamed = NEW_PREFIX + key.slice(OLD_PREFIX.length);
    if (value !== null && storage.getItem(renamed) === null) storage.setItem(renamed, value);
    storage.removeItem(key);
  }
};
