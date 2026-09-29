export const singleFlight = (run: () => Promise<void>) => {
  let inflight: Promise<void> | null = null;
  let queued: Promise<void> | null = null;
  const trigger = (): Promise<void> => {
    if (!inflight) {
      inflight = run().finally(() => {
        inflight = null;
      });
      return inflight;
    }
    queued ??= inflight
      .catch(() => undefined)
      .then(() => {
        queued = null;
        return trigger();
      });
    return queued;
  };
  return trigger;
};
