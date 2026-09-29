import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const NEAR_BOTTOM_PX = 120;

export const useStickToBottom = (renderKey: unknown) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const anchorRef = useRef<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (anchorRef.current !== null) {
      element.scrollTop = element.scrollHeight - anchorRef.current;
      anchorRef.current = null;
    } else if (stickRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [renderKey]);

  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element || !content) return;
    const observer = new ResizeObserver(() => {
      if (stickRef.current && anchorRef.current === null) element.scrollTop = element.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const near = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    stickRef.current = near;
    setAtBottom(near);
  }, []);

  const keepPosition = useCallback(() => {
    const element = scrollRef.current;
    if (element) anchorRef.current = element.scrollHeight - element.scrollTop;
  }, []);

  const jumpToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    stickRef.current = true;
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, []);

  return { scrollRef, contentRef, atBottom, onScroll, keepPosition, jumpToBottom };
};
