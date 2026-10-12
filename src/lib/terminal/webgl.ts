import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

const MAX_WEBGL_CONTEXTS = 6;

interface WebglHost {
  term: Terminal;
  element: HTMLElement;
  webgl: WebglAddon | null;
}

const order: WebglHost[] = [];

export const releaseWebgl = (host: WebglHost) => {
  host.webgl?.dispose();
  host.webgl = null;
  const index = order.indexOf(host);
  if (index >= 0) order.splice(index, 1);
};

const evictHidden = () => {
  while (order.length > MAX_WEBGL_CONTEXTS) {
    const hidden = order.find((host) => !host.element.isConnected);
    if (!hidden) return;
    releaseWebgl(hidden);
  }
};

export const ensureWebgl = (host: WebglHost) => {
  const index = order.indexOf(host);
  if (index >= 0) order.splice(index, 1);
  if (!host.webgl) {
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => releaseWebgl(host));
      host.term.loadAddon(addon);
      host.webgl = addon;
    } catch {
      host.webgl = null;
      return;
    }
  }
  order.push(host);
  evictHidden();
};
