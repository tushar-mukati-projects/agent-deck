const PREFIX = "diff::";

export type DiffSource = "session" | "git";

export interface DiffTab {
  source: DiffSource;
  path: string;
  backup: string | null;
}

export const encodeDiffTab = ({ source, path, backup }: DiffTab) => `${PREFIX}${source}::${backup ?? ""}::${path}`;

export const decodeDiffTab = (value: string): DiffTab | null => {
  if (!value.startsWith(PREFIX)) return null;
  const [source, backup, ...rest] = value.slice(PREFIX.length).split("::");
  if (source !== "session" && source !== "git") return null;
  return { source, backup: backup || null, path: rest.join("::") };
};

export const isDiffTab = (value: string) => value.startsWith(PREFIX);
