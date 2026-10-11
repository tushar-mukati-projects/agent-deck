import { useEffect } from "react";

export const useWindowActivity = () =>
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => {
      root.dataset.window = document.hasFocus() && !document.hidden ? "active" : "inactive";
    };
    sync();
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
      document.removeEventListener("visibilitychange", sync);
      delete root.dataset.window;
    };
  }, []);
