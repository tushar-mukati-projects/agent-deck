import { useEffect, useState, type DependencyList } from "react";

import { errorMessage } from "@/lib/utils";

type PollStep = (active: () => boolean) => Promise<void>;

export const usePolling = (
  start: (() => PollStep) | null,
  intervalMs: number | null,
  deps: DependencyList,
) => {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!start) return;
    const step = start();
    let cancelled = false;
    let timer: number | undefined;
    const active = () => !cancelled;
    const poll = async () => {
      try {
        await step(active);
        if (!cancelled) setError(null);
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      }
      if (!cancelled && intervalMs !== null)
        timer = window.setTimeout(() => void poll(), intervalMs);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, deps);

  return error;
};
