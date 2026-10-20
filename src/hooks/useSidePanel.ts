import { useEffect, useState } from "react";
import { usePanelRef, type PanelSize } from "react-resizable-panels";

import { holdTerminalFits } from "@/lib/terminal/registry";
import { useUiStore, type SidePanel } from "@/stores/ui-store";

const FLAG = { sessions: "sessionsOpen", context: "contextOpen" } as const;
const WIDTH = { sessions: "sessionsWidth", context: "contextWidth" } as const;
const PANEL_ANIMATION_MS = 180;
const PANEL_ANIMATION_SLACK_MS = 20;

let panelTimer: number | undefined;
const animatePanels = () => {
  const root = document.documentElement;
  root.style.setProperty("--panel-animation", `${PANEL_ANIMATION_MS}ms`);
  root.classList.add("panels-animating");
  holdTerminalFits(PANEL_ANIMATION_MS);
  window.clearTimeout(panelTimer);
  panelTimer = window.setTimeout(
    () => root.classList.remove("panels-animating"),
    PANEL_ANIMATION_MS + PANEL_ANIMATION_SLACK_MS,
  );
};

let draggingSeparator = false;
window.addEventListener(
  "pointerdown",
  (event) => {
    draggingSeparator =
      event.target instanceof Element && !!event.target.closest("[data-separator]");
  },
  true,
);
window.addEventListener("pointerup", () => (draggingSeparator = false), true);

export const useSidePanel = (panel: SidePanel, available = true) => {
  const panelRef = usePanelRef();
  const open = useUiStore((s) => s[FLAG[panel]]) && available;
  const [initialWidth] = useState(() => useUiStore.getState()[WIDTH[panel]]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const handle = panelRef.current;
      if (!handle) return;
      if (open === !handle.isCollapsed()) return;
      animatePanels();
      if (open) handle.resize(useUiStore.getState()[WIDTH[panel]]);
      else handle.collapse();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, panel, panelRef]);

  const onResize = (size: PanelSize) => {
    if (!available || !draggingSeparator) return;
    const collapsed = size.inPixels < 1;
    const state = useUiStore.getState();
    if (collapsed === state[FLAG[panel]]) useUiStore.setState({ [FLAG[panel]]: !collapsed });
    if (!collapsed) state.setPanelWidth(panel, Math.round(size.inPixels));
  };

  return { panelRef, onResize, initialWidth };
};
