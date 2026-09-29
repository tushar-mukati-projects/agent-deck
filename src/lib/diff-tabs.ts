const DIFF_PREFIX = "diff::";
const MCP_PREFIX = "mcp::";

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

export const encodeMcpTab = (serverId: string) => `${MCP_PREFIX}${serverId}`;

export const decodeMcpTab = (value: string) =>
  value.startsWith(MCP_PREFIX) ? value.slice(MCP_PREFIX.length) : null;

export const tabTargetPath = (value: string) => decodeDiffTab(value)?.path ?? value;
