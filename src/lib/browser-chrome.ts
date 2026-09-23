const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  !target.closest("[data-terminal-kind]") &&
  !!target.closest("input, textarea, [contenteditable='true'], .cm-content");

export const suppressBrowserChrome = () => {
  window.addEventListener("contextmenu", (event) => {
    if (!event.defaultPrevented && !isEditable(event.target)) event.preventDefault();
  });
  if (!import.meta.env.PROD) return;
  window.addEventListener(
    "keydown",
    (event) => {
      const reload = event.key === "F5" || (event.ctrlKey && event.key.toLowerCase() === "r");
      const navigate = event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight");
      const print = event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "p";
      if (!reload && !navigate && !print) return;
      if ((event.target as HTMLElement | null)?.closest?.("[data-terminal-kind]")) return;
      event.preventDefault();
    },
    true,
  );
};
