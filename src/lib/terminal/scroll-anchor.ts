export interface Rows {
  count: number;
  text: (row: number) => string;
}

export interface ScrollAnchor {
  probes: { text: string; offset: number }[];
  ratio: number;
}

const PROBE_ROWS = 12;
const PREFIX_CHARS = 32;
const MIN_PROBE_CHARS = 6;

const prefixOf = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, PREFIX_CHARS);

export const captureAnchor = (rows: Rows, top: number, maxTop: number): ScrollAnchor => {
  const probes: ScrollAnchor["probes"] = [];
  for (let offset = 0; offset < PROBE_ROWS && top + offset < rows.count; offset++) {
    const text = prefixOf(rows.text(top + offset));
    if (text.length >= MIN_PROBE_CHARS) probes.push({ text, offset });
  }
  return { probes, ratio: maxTop > 0 ? top / maxTop : 0 };
};

export const locateAnchor = (rows: Rows, anchor: ScrollAnchor, maxTop: number) => {
  const clamp = (row: number) => Math.min(Math.max(Math.round(row), 0), maxTop);
  const expected = anchor.ratio * maxTop;
  const wanted = new Set(anchor.probes.map((probe) => probe.text));
  const found = new Map<string, number[]>();
  for (let row = 0; row < rows.count; row++) {
    const text = prefixOf(rows.text(row));
    if (wanted.has(text)) found.set(text, [...(found.get(text) ?? []), row]);
  }
  const candidates = anchor.probes
    .map((probe) => (found.get(probe.text) ?? []).map((row) => row - probe.offset))
    .filter((tops) => tops.length > 0)
    .sort((a, b) => a.length - b.length)[0];
  if (!candidates) return clamp(expected);
  const nearest = candidates.reduce((best, top) =>
    Math.abs(top - expected) < Math.abs(best - expected) ? top : best,
  );
  return clamp(nearest);
};
