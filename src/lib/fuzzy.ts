const isBoundary = (text: string, index: number) => {
  if (index === 0) return true;
  const previous = text[index - 1];
  return (
    previous === "/" ||
    previous === "\\" ||
    previous === " " ||
    previous === "-" ||
    previous === "_" ||
    previous === "."
  );
};

const termScore = (terms: string[], text: string, length: number): number | null => {
  let score = 0;
  for (const term of terms) {
    const index = text.indexOf(term);
    if (index < 0) return null;
    score += 300 - Math.min(index, 200) + (isBoundary(text, index) ? 120 : 0);
  }
  return score - length * 0.2;
};

const queryTerms = (query: string) => {
  const trimmed = query.trim();
  return /\s/.test(trimmed) ? trimmed.split(/\s+/).filter(Boolean) : null;
};

const lowerScore = (
  query: string,
  text: string,
  length: number,
  terms = queryTerms(query),
): number | null => {
  if (!query) return 0;
  if (terms) return termScore(terms, text, length);
  const direct = text.indexOf(query);
  if (direct >= 0) return 1000 - direct + (isBoundary(text, direct) ? 200 : 0) - length * 0.5;

  let score = 0;
  let textIndex = 0;
  let streak = 0;
  for (const char of query) {
    const found = text.indexOf(char, textIndex);
    if (found < 0) return null;
    streak = found === textIndex ? streak + 1 : 0;
    score += 10 + streak * 6 + (isBoundary(text, found) ? 14 : 0) - Math.min(found - textIndex, 12);
    textIndex = found + 1;
  }
  return score - length * 0.5;
};

export const fuzzyScore = (query: string, target: string): number | null =>
  lowerScore(query, target.toLowerCase(), target.length);

export interface PathKey {
  path: string;
  name: string;
  pathLength: number;
  nameLength: number;
}

export const pathKey = (path: string): PathKey => {
  const normalized = path.replace(/\\/g, "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  return {
    path: normalized.toLowerCase(),
    name: name.toLowerCase(),
    pathLength: normalized.length,
    nameLength: name.length,
  };
};

export const fuzzyPathKeyScorer = (query: string) => {
  const terms = queryTerms(query);
  return (key: PathKey) => {
    const nameScore = lowerScore(query, key.name, key.nameLength, terms);
    const pathScore = lowerScore(query, key.path, key.pathLength, terms);
    if (nameScore === null && pathScore === null) return null;
    return Math.max((nameScore ?? -Infinity) + 400, pathScore ?? -Infinity);
  };
};
