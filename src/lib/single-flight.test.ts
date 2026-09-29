import { describe, expect, it } from "vitest";

import { singleFlight } from "@/lib/single-flight";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

describe("singleFlight", () => {
  it("runs once at a time and queues a single re-run", async () => {
    const gates = [deferred(), deferred()];
    let calls = 0;
    const trigger = singleFlight(() => gates[calls++].promise);
    const first = trigger();
    const second = trigger();
    const third = trigger();
    expect(calls).toBe(1);
    expect(second).toBe(third);
    gates[0].resolve();
    await first;
    await Promise.resolve();
    expect(calls).toBe(2);
    gates[1].resolve();
    await second;
    expect(calls).toBe(2);
  });

  it("still runs the queued call after a failure", async () => {
    let calls = 0;
    const trigger = singleFlight(async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
    });
    const first = trigger();
    const second = trigger();
    await expect(first).rejects.toThrow("boom");
    await second;
    expect(calls).toBe(2);
  });
});
