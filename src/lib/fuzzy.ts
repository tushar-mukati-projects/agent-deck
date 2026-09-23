const isBoundary = (text: string, index: number) => {
  if (index === 0) return true;
  const previous = text[index - 1];
  return previous === "/" || previous === "\\" || previous === " " || previous === "-" || previous === "_" || previous === ".";
};

const termScore = (query: string, target: string): number | null => {
  const terms = query.split(/\s+/).filter(Boolean);
  const text = target.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const index = text.indexOf(term);
    if (index < 0) return null;
    score += 300 - Math.min(index, 200) + (isBoundary(text, index) ? 120 : 0);
  }
  return score - target.length * 0.2;
};

export const fuzzyScore = (query: string, target: string): number | null => {
  if (!query) return 0;
  if (/\s/.test(query.trim())) return termScore(query.trim(), target);
  const text = target.toLowerCase();
  const direct = text.indexOf(query);
  if (direct >= 0) return 1000 - direct + (isBoundary(text, direct) ? 200 : 0) - target.length * 0.5;

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
  return score - target.length * 0.5;
};

export const fuzzyPathScore = (query: string, path: string) => {
  const normalized = path.replace(/\\/g, "/");
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  const nameScore = fuzzyScore(query, name);
  const pathScore = fuzzyScore(query, normalized);
  if (nameScore === null && pathScore === null) return null;
  return Math.max((nameScore ?? -Infinity) + 400, pathScore ?? -Infinity);
};
