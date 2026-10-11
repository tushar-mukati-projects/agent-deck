import { useEffect, useRef } from "react";

import { clampScroll, FRAME_MS, GLIDE_MIN_PX, glideStep, horizontalDelta } from "@/lib/wheel";

export const useHorizontalWheel = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let position = element.scrollLeft;
    let target = position;
    let last = 0;

    const glide = (now: number) => {
      position = glideStep(position, target, last ? now - last : FRAME_MS);
      last = now;
      element.scrollLeft = position;
      frame = position === target ? 0 : requestAnimationFrame(glide);
    };

    const onWheel = (event: WheelEvent) => {
      const max = element.scrollWidth - element.clientWidth;
      if (event.ctrlKey || max <= 0) return;
      event.preventDefault();
      if (!frame && Math.abs(element.scrollLeft - position) > 1)
        position = target = element.scrollLeft;
      const delta = horizontalDelta(event, element.clientWidth);
      target = clampScroll((frame ? target : position) + delta, max);
      if (frame) return;
      if (calm.matches || Math.abs(delta) < GLIDE_MIN_PX) {
        position = target;
        element.scrollLeft = position;
        return;
      }
      last = 0;
      frame = requestAnimationFrame(glide);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame);
    };
  }, []);

  return ref;
};
