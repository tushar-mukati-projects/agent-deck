let context: AudioContext | null = null;

const tone = (
  ctx: AudioContext,
  frequency: number,
  start: number,
  duration: number,
  volume: number,
) => {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
};

export type ChimeKind = "done" | "input";

export const playChime = (kind: ChimeKind) => {
  try {
    context ??= new AudioContext();
    const ctx = context;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime + 0.02;
    if (kind === "done") {
      tone(ctx, 659.25, now, 0.45, 0.07);
      tone(ctx, 987.77, now + 0.12, 0.6, 0.06);
    } else {
      tone(ctx, 783.99, now, 0.25, 0.07);
      tone(ctx, 783.99, now + 0.18, 0.35, 0.06);
    }
  } catch {
    return;
  }
};
