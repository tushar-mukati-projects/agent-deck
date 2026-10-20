import { fuzzyPathKeyScorer, type PathKey } from "@/lib/fuzzy";

export type PreparedFile = {
  rel: string;
  key: PathKey;
};

export type ScoredFile = {
  rel: string;
  score: number;
};

export const sortTop = <T extends { score: number }>(list: T[], limit: number) =>
  list.sort((a, b) => b.score - a.score).slice(0, limit);

export const topFiles = (files: PreparedFile[], query: string, limit: number) => {
  if (!query)
    return { top: files.slice(0, limit).map(({ rel }) => ({ rel, score: 0 })), matched: files };
  const scoreOf = fuzzyPathKeyScorer(query);
  const top: ScoredFile[] = [];
  const matched: PreparedFile[] = [];
  for (const file of files) {
    const score = scoreOf(file.key);
    if (score === null) continue;
    matched.push(file);
    if (top.length < limit) top.push({ rel: file.rel, score });
    else if (score > top[top.length - 1].score) top[top.length - 1] = { rel: file.rel, score };
    else continue;
    top.sort((a, b) => b.score - a.score);
  }
  return { top, matched };
};
