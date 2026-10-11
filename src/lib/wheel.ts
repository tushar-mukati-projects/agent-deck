const LINE_PX = 20;
const RETAIN_PER_FRAME = 0.6;
const SETTLE_PX = 0.5;

export const FRAME_MS = 1000 / 60;
export const GLIDE_MIN_PX = 50;

export interface WheelDelta {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}

export const horizontalDelta = ({ deltaX, deltaY, deltaMode }: WheelDelta, pageWidth: number) => {
  const delta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY;
  if (deltaMode === 1) return delta * LINE_PX;
  if (deltaMode === 2) return delta * pageWidth;
  return delta;
};

export const clampScroll = (value: number, max: number) =>
  Math.min(Math.max(value, 0), Math.max(max, 0));

export const glideStep = (position: number, target: number, elapsedMs: number) => {
  const next =
    target - (target - position) * RETAIN_PER_FRAME ** (Math.max(elapsedMs, 0) / FRAME_MS);
  return Math.abs(target - next) < SETTLE_PX ? target : next;
};
