import type { FsChange } from "@/types";

type Listener = (change: FsChange) => void;

const RELEASE_GRACE_MS = 3000;

const listeners = new Set<Listener>();
const watches = new Map<string, { count: number; since: number; releaseTimer?: number }>();

export const subscribeFileChanges = (listener: Listener) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export const publishFileChange = (change: FsChange) => {
  for (const listener of listeners) listener(change);
};

export const retainWatch = (root: string, watch: (root: string) => Promise<void>) => {
  const current = watches.get(root);
  if (current) {
    window.clearTimeout(current.releaseTimer);
    current.releaseTimer = undefined;
    current.count += 1;
    return false;
  }
  watches.set(root, { count: 1, since: Date.now() });
  void watch(root).catch(() => undefined);
  return true;
};

export const releaseWatch = (root: string, unwatch: (root: string) => Promise<void>) => {
  const current = watches.get(root);
  if (!current) return;
  current.count -= 1;
  if (current.count > 0) return;
  current.releaseTimer = window.setTimeout(() => {
    watches.delete(root);
    void unwatch(root).catch(() => undefined);
  }, RELEASE_GRACE_MS);
};

export const watchedRoots = () => [...watches.keys()];

export const watchedSince = (root: string) => watches.get(root)?.since ?? null;
