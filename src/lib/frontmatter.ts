const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** Splits YAML frontmatter (simple `key: value` lines) from the markdown body. */
export const splitFrontmatter = (source: string) => {
  const match = FRONTMATTER.exec(source);
  if (!match) return { fields: [] as [string, string][], body: source };
  const fields: [string, string][] = [];
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([\w.-]+):\s*(.*)$/.exec(line);
    if (pair) fields.push([pair[1], pair[2].replace(/^["']|["']$/g, "")]);
    else if (fields.length && line.trim()) fields[fields.length - 1][1] += ` ${line.trim()}`;
  }
  return { fields, body: source.slice(match[0].length) };
};
