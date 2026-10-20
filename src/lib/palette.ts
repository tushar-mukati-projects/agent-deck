import { fuzzyPathKeyScorer, type PathKey } from "@/lib/fuzzy";
import type { PaletteMode } from "@/stores/ui-store";

export const MIN_CHAT_QUERY_CHARS = 2;

export type PreparedFile = {
  rel: string;
  key: PathKey;
  isDir: boolean;
};

export type ScoredFile = {
  rel: string;
  isDir: boolean;
  score: number;
};

export type EmptyHintState = {
  mode: PaletteMode;
  hasWorkspace: boolean;
  query: string;
  searchingChats: boolean;
  chatError: string | null;
  filesError: string | null;
};

export const sortTop = <T extends { score: number }>(list: T[], limit: number) =>
  list.sort((a, b) => b.score - a.score).slice(0, limit);

const lastSeparator = (path: string, before: number) =>
  Math.max(path.lastIndexOf("\\", before), path.lastIndexOf("/", before));

export const foldersOf = (files: string[]) => {
  const folders = new Set<string>();
  for (const rel of files) {
    for (let end = lastSeparator(rel, rel.length - 1); end > 0; end = lastSeparator(rel, end - 1)) {
      const folder = rel.slice(0, end);
      if (folders.has(folder)) break;
      folders.add(folder);
    }
  }
  return [...folders];
};

export const topFiles = (files: PreparedFile[], query: string, limit: number) => {
  if (!query)
    return {
      top: files.slice(0, limit).map(({ rel, isDir }) => ({ rel, isDir, score: 0 })),
      matched: files,
    };
  const scoreOf = fuzzyPathKeyScorer(query);
  const top: ScoredFile[] = [];
  const matched: PreparedFile[] = [];
  for (const file of files) {
    const score = scoreOf(file.key);
    if (score === null) continue;
    matched.push(file);
    const scored = { rel: file.rel, isDir: file.isDir, score };
    if (top.length < limit) top.push(scored);
    else if (score > top[top.length - 1].score) top[top.length - 1] = scored;
    else continue;
    top.sort((a, b) => b.score - a.score);
  }
  return { top, matched };
};

export const emptyHint = ({
  mode,
  hasWorkspace,
  query,
  searchingChats,
  chatError,
  filesError,
}: EmptyHintState) => {
  if (mode === "files" && !hasWorkspace) return "Open a session to search its files.";
  if (mode !== "chats") return filesError ?? "Nothing matches.";
  if (query.length < MIN_CHAT_QUERY_CHARS)
    return `Type at least ${MIN_CHAT_QUERY_CHARS} characters to search every conversation.`;
  if (searchingChats) return "Searching conversations…";
  return chatError ?? "No conversation mentions that.";
};
