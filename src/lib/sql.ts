export const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

export const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

const NOISE = /--[^\n]*|\/\*[\s\S]*?\*\/|\$(\w*)\$[\s\S]*?\$\1\$|'(?:[^']|'')*'|"(?:[^"]|"")*"/g;

const stripNoise = (sql: string) =>
  sql.replace(NOISE, (match) =>
    match.startsWith('"') ? ' ""' : match.startsWith("'") || match.startsWith("$") ? " ''" : " ",
  );

const READ_ONLY = new Set(["select", "show", "values", "table", "fetch"]);
const WRITES = /\b(insert|update|delete|merge|truncate|drop|alter|create|grant|revoke)\b/i;

const statementWrites = (statement: string): boolean => {
  const words = statement.trim().toLowerCase().split(/\s+/);
  const first = words[0] ?? "";
  if (!first) return false;
  if (READ_ONLY.has(first)) return /\binto\b/i.test(statement) && first === "select";
  if (first === "with") return WRITES.test(statement);
  if (first === "explain") {
    const analyze = /\banalyze\b/i.test(statement);
    return analyze && WRITES.test(statement);
  }
  return true;
};

export const isMutating = (sql: string) => stripNoise(sql).split(";").some(statementWrites);
