import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";

import { errorMessage } from "@/lib/utils";

interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
}

export const useAsync = <T>(
  load: (() => Promise<T>) | null,
  deps: DependencyList,
  { keepPrevious = false } = {},
) => {
  const [state, setState] = useState<AsyncState<T>>({
    data: undefined,
    error: null,
    loading: !!load,
  });
  const loadRef = useRef(load);
  loadRef.current = load;
  const request = useRef(0);

  const run = useCallback(
    async (quiet = false) => {
      const id = ++request.current;
      const fn = loadRef.current;
      if (!fn) {
        setState({ data: undefined, error: null, loading: false });
        return;
      }
      setState((s) => ({
        data: quiet || keepPrevious ? s.data : undefined,
        error: quiet ? s.error : null,
        loading: true,
      }));
      try {
        const data = await fn();
        if (id === request.current) setState({ data, error: null, loading: false });
      } catch (error) {
        if (id === request.current)
          setState((s) => ({ data: s.data, error: errorMessage(error), loading: false }));
      }
    },
    [keepPrevious],
  );

  useEffect(() => {
    void run();
  }, deps);

  useEffect(
    () => () => {
      request.current += 1;
    },
    [],
  );

  return { ...state, reload: run };
};

export const useThrottledCallback = (callback: () => void, delay: number, maxWait: number) => {
  const latest = useRef(callback);
  latest.current = callback;
  const timer = useRef<number | undefined>(undefined);
  const firstCall = useRef<number | null>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return useCallback(() => {
    const now = Date.now();
    firstCall.current ??= now;
    window.clearTimeout(timer.current);
    const wait = Math.max(0, Math.min(delay, firstCall.current + maxWait - now));
    timer.current = window.setTimeout(() => {
      firstCall.current = null;
      latest.current();
    }, wait);
  }, [delay, maxWait]);
};
