import type { FsChange } from "@/types";

type Listener = (change: FsChange) => void;

const listeners = new Set<Listener>();
const watchCounts = new Map<string, number>();

export const subscribeFileChanges = (listener: Listener) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const publishFileChange = (change: FsChange) => {
  for (const listener of listeners) listener(change);
};

export const retainWatch = (root: string, watch: (root: string) => Promise<void>) => {
  const count = watchCounts.get(root) ?? 0;
  watchCounts.set(root, count + 1);
  if (count === 0) void watch(root).catch(() => undefined);
};

export const releaseWatch = (root: string, unwatch: (root: string) => Promise<void>) => {
  const count = (watchCounts.get(root) ?? 1) - 1;
  if (count <= 0) {
    watchCounts.delete(root);
    void unwatch(root).catch(() => undefined);
  } else {
    watchCounts.set(root, count);
  }
};
