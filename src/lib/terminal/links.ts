import type { ILink, Terminal } from "@xterm/xterm";

import { joinPath, samePath } from "@/lib/utils";
import { parseWslPath, wslUncPath } from "@/lib/wsl";

const EXTENSIONS =
  "ts|tsx|js|jsx|mjs|cjs|json|jsonl|md|mdx|py|rs|go|java|kt|cs|cpp|cc|c|h|hpp|css|scss|html|vue|svelte|yml|yaml|toml|ini|sh|ps1|bat|txt|log|sql|prisma|xml|svg|png|jpg|jpeg|gif|webp|mp4|webm|mov|mp3|wav|lock|env|gradle|swift|rb|php|lua|dart|tf";

const PATH_PATTERN = new RegExp(
  String.raw`(?<![\w/\\:.-])((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w@.+-]+[\\/])*[\w@+-]+\.(?:${EXTENSIONS}))(?::(\d+))?(?![\w/\\])`,
  "g",
);

export interface PathLinkTarget {
  raw: string;
  line: number | null;
}

export const candidatePaths = (raw: string, bases: string[]) => {
  if (/^[A-Za-z]:[\\/]/.test(raw)) return [raw];
  const wsl = bases.map(parseWslPath).find(Boolean);
  if (raw.startsWith("/") && wsl) return [wslUncPath(wsl.distro, raw)];
  const relative = raw.replace(/^\.[\\/]/, "");
  const paths: string[] = [];
  for (const base of bases) {
    const path = joinPath(base, relative);
    if (!paths.some((p) => samePath(p, path))) paths.push(path);
  }
  return paths;
};

export const registerPathLinks = (term: Terminal, onOpen: (target: PathLinkTarget) => void) =>
  term.registerLinkProvider({
    provideLinks: (lineNumber, callback) => {
      const text = term.buffer.active.getLine(lineNumber - 1)?.translateToString(true) ?? "";
      const links: ILink[] = [];
      for (const match of text.matchAll(PATH_PATTERN)) {
        const [whole, raw, line] = match;
        const start = match.index ?? 0;
        if (text.slice(Math.max(0, start - 3), start).includes("://")) continue;
        links.push({
          text: whole,
          range: {
            start: { x: start + 1, y: lineNumber },
            end: { x: start + whole.length, y: lineNumber },
          },
          decorations: { underline: true, pointerCursor: true },
          activate: () => onOpen({ raw, line: line ? Number(line) : null }),
        });
      }
      callback(links.length ? links : undefined);
    },
  });
