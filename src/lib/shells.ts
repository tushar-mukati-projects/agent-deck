import { basename } from "@/lib/utils";
import { parseWslPath, shellQuote } from "@/lib/wsl";
import type { ShellTab } from "@/types";

export const shellName = (shell: Pick<ShellTab, "program">, index: number) =>
  `${basename(shell.program).replace(/\.exe$/i, "")} ${index + 1}`;

export const shellPath = (path: string) => {
  const wsl = parseWslPath(path);
  return wsl ? `${shellQuote(wsl.linuxPath)} ` : `"${path}" `;
};
