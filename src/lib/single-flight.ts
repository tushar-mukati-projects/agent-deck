export const singleFlight = (run: () => Promise<void>) => {
  let inflight: Promise<void> | null = null;
  let queued = false;
  const trigger = (): Promise<void> => {
    if (inflight) {
      queued = true;
      return inflight;
    }
    inflight = run().finally(() => {
      inflight = null;
      if (queued) {
        queued = false;
        void trigger();
      }
    });
    return inflight;
  };
  return trigger;
};
