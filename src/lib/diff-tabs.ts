const DIFF_PREFIX = "diff::";
const MEDIA_PREFIX = "media::";

export type DiffSource = "session" | "git";

export interface DiffTab {
  source: DiffSource;
  path: string;
  backup: string | null;
}

export const encodeDiffTab = ({ source, path, backup }: DiffTab) =>
  `${DIFF_PREFIX}${source}::${backup ?? ""}::${path}`;

export const decodeDiffTab = (value: string): DiffTab | null => {
  if (!value.startsWith(DIFF_PREFIX)) return null;
  const [source, backup, ...rest] = value.slice(DIFF_PREFIX.length).split("::");
  if (source !== "session" && source !== "git") return null;
  return { source, backup: backup || null, path: rest.join("::") };
};

export const isDiffTab = (value: string) => value.startsWith(DIFF_PREFIX);

export const encodeMediaTab = (root: string) => `${MEDIA_PREFIX}${root}`;

export const decodeMediaTab = (value: string) =>
  value.startsWith(MEDIA_PREFIX) ? value.slice(MEDIA_PREFIX.length) : null;

export const tabTargetPath = (value: string) =>
  decodeDiffTab(value)?.path ?? decodeMediaTab(value) ?? value;
