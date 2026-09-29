import { useSyncExternalStore } from "react";

import { timeAgo } from "@/lib/utils";

const TICK_MS = 30_000;
const listeners = new Set<() => void>();
let now = Date.now();
let timer: number | undefined;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  timer ??= window.setInterval(() => {
    now = Date.now();
    listeners.forEach((notify) => notify());
  }, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size || timer === undefined) return;
    window.clearInterval(timer);
    timer = undefined;
  };
};

const useClock = () => useSyncExternalStore(subscribe, () => now);

export const TimeAgo = ({ ms, className }: { ms: number; className?: string }) => {
  useClock();
  return <span className={className}>{timeAgo(ms)}</span>;
};
