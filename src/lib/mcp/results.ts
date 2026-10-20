export type Cell = string | null;

export type Grid = {
  columns: string[];
  rows: Cell[][];
};

export type ContentItem = {
  type?: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri?: string; text?: string };
};

const JSON_INDENT = 2;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const field = (value: unknown, name: string) => (isRecord(value) ? value[name] : undefined);

const asItems = (value: unknown): ContentItem[] =>
  Array.isArray(value) ? value.filter((v): v is ContentItem => !!v && typeof v === "object") : [];

const csvCell = (value: Cell) => {
  if (value === null) return "";
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
};

export const toCsv = (columns: string[], rows: Cell[][]) =>
  [columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

export const toJson = (columns: string[], rows: Cell[][]) =>
  JSON.stringify(
    rows.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]]))),
    null,
    JSON_INDENT,
  );

export const gridFromObjects = (value: unknown): Grid | null => {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isRecord)) return null;
  const columns = [...new Set(value.flatMap((v) => Object.keys(v)))];
  const rows = value.map((v) =>
    columns.map((c) => {
      const cell = v[c];
      if (cell === null || cell === undefined) return null;
      return typeof cell === "object" ? JSON.stringify(cell) : String(cell);
    }),
  );
  return { columns, rows };
};

export const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

export const callResultParts = (result: unknown) => ({
  content: asItems(field(result, "content")),
  isError: !!field(result, "isError"),
  structured: field(result, "structuredContent"),
});

export const resourceTexts = (value: unknown) =>
  asItems(field(value, "contents")).map((c) =>
    typeof c.text === "string" ? c.text : JSON.stringify(c, null, JSON_INDENT),
  );
