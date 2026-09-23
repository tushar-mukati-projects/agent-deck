let context: AudioContext | null = null;

const audio = () => (context ??= new AudioContext());

/**
 * WebView2 keeps an AudioContext created outside a user gesture suspended, so a chime fired
 * later by terminal output would be silent. Create and resume it on the first click or key.
 */
export const unlockAudio = () => {
  const unlock = () => {
    try {
      void audio().resume();
    } catch {
      return;
    }
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
};

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

export const playChime = async (kind: ChimeKind) => {
  try {
    const ctx = audio();
    if (ctx.state !== "running") await ctx.resume();
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
