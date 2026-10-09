export type AgentId = string;

export type ConfigAgent = "claude" | "codex";

export interface CustomAgent {
  id: string;
  name: string;
  command: string;
}

export interface SessionInfo {
  id: string;
  agent: AgentId;
  distro: string | null;
  filePath: string;
  projectKey: string;
  cwd: string;
  title: string | null;
  customTitle: string | null;
  firstPrompt: string | null;
  lastPrompt: string | null;
  gitBranch: string | null;
  startedAt: string | null;
  lastMessageAt: string | null;
  modifiedMs: number;
  promptCount: number;
  size: number;
  version: string | null;
  recentCwds: string[];
}

export interface LiveSession {
  distro: string | null;
  sessionId: string;
  pid: number;
  cwd: string | null;
  status: string | null;
  kind: string | null;
  name: string | null;
  startedAt: number | null;
}

export interface TranscriptItem {
  role: "user" | "assistant";
  kind: "text" | "tool";
  text: string;
  timestamp: string | null;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  hidden: boolean;
  size: number;
  modifiedMs: number;
}

export interface TranscriptPage {
  items: TranscriptItem[];
  offset: number;
  reset: boolean;
}

export type FileEncoding = "utf8" | "utf16le" | "utf16be" | "lossy";

export type FileContent =
  | { kind: "text"; text: string; size: number; modifiedMs: number; encoding: FileEncoding }
  | { kind: "binary"; size: number }
  | { kind: "tooLarge"; size: number };

export type WriteOutcome =
  { kind: "saved"; modifiedMs: number } | { kind: "conflict"; modifiedMs: number };

export type AgentTaskStatus = "running" | "completed" | "failed" | "killed" | "stopped";

export interface Subagent {
  id: string;
  agentId: string | null;
  description: string | null;
  agentType: string | null;
  startedAt: string | null;
  endedAt: string | null;
  status: AgentTaskStatus;
}

export interface SessionTasks {
  shells: AgentTask[];
  agents: Subagent[];
}

export interface AgentTask {
  id: string;
  tool: string;
  command: string;
  description: string | null;
  outputPath: string | null;
  startedAt: string | null;
  endedAt: string | null;
  status: AgentTaskStatus;
  summary: string | null;
}

export interface FileTail {
  text: string;
  size: number;
  truncated: boolean;
}

export interface PathStat {
  kind: "file" | "dir";
  size: number;
  modifiedMs: number;
}

export interface PtyInfo {
  id: string;
  pid: number | null;
  exitCode: number | null;
  exited: boolean;
}

export type PtyEvent = { type: "data"; data: string } | { type: "exit"; code: number | null };

export interface SpawnRequest {
  id: string;
  cwd: string;
  program: string;
  args: string[];
  cols: number;
  rows: number;
}

export interface AppEnvironment {
  home: string;
  claudeHome: string;
  shell: string;
  claudeFound: boolean;
  codexFound: boolean;
}

export type ChangeStatus = "added" | "modified" | "deleted" | "unchanged";

export interface ChangedFile {
  path: string;
  status: ChangeStatus;
  additions: number;
  deletions: number;
  edits: number;
  backup: string | null;
}

export interface GitChange {
  path: string;
  code: string;
}

export interface SearchHit {
  sessionId: string;
  role: "user" | "assistant";
  snippet: string;
  timestamp: string | null;
}

export type ConfigScope = "user" | "project" | "local" | "plugin" | "auto" | "system";

export interface MemoryFile {
  scope: ConfigScope;
  label: string;
  path: string;
  exists: boolean;
  description: string | null;
  size: number;
  modifiedMs: number;
}

export interface McpServer {
  id: string;
  name: string;
  scope: ConfigScope;
  plugin: string | null;
  source: string;
  transport: string;
  command: string | null;
  args: string[];
  url: string | null;
  envKeys: string[];
  headerKeys: string[];
  postgres: boolean;
  disabled: boolean;
}

export interface ConfigItem {
  name: string;
  description: string | null;
  path: string;
  scope: ConfigScope;
  plugin: string | null;
}

export interface ConfigHook {
  event: string;
  matcher: string | null;
  command: string;
  scope: ConfigScope;
  plugin: string | null;
  source: string;
  group: number;
  index: number;
}

export interface SettingsFile {
  scope: ConfigScope;
  label: string;
  path: string;
  exists: boolean;
  error?: string | null;
  model: string | null;
  defaultMode: string | null;
  allow: string[];
  deny: string[];
  ask: string[];
  envKeys: string[];
}

export interface ConfigPlugin {
  name: string;
  version: string | null;
  scope: string;
  enabled: boolean;
  path: string;
}

export interface AgentOverview {
  home: string;
  distro: string | null;
  memory: MemoryFile[];
  mcp: McpServer[];
  skills: ConfigItem[];
  agents: ConfigItem[];
  commands: ConfigItem[];
  hooks: ConfigHook[];
  settings: SettingsFile[];
  plugins: ConfigPlugin[];
}

export type ConfigRemoval =
  | { kind: "memory"; path: string }
  | { kind: "skill"; path: string }
  | { kind: "file"; path: string }
  | { kind: "mcpServer"; id: string }
  | { kind: "hook"; source: string; event: string; group: number; index: number; command: string }
  | { kind: "rule"; path: string; list: "allow" | "ask" | "deny"; rule: string }
  | { kind: "plugin"; name: string };

export interface McpTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonSchema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string };
}

export interface JsonSchema {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  default?: unknown;
  enum?: unknown[];
  items?: JsonSchema;
}

export interface McpDescription {
  serverInfo: { name?: string; title?: string; version?: string } | null;
  instructions: string | null;
  tools: McpTool[];
  resources: { uri: string; name?: string; description?: string; mimeType?: string }[];
  prompts: { name: string; description?: string }[];
}

export interface PgResult {
  columns: string[];
  rows: (string | null)[][];
  rowCount: number;
  truncated: boolean;
}

export interface PgOutput {
  results: PgResult[];
  elapsedMs: number;
}

export interface PgInfo {
  host: string;
  port: number;
  database: string;
  user: string;
}

export interface WslDistro {
  name: string;
  running: boolean;
}

export interface WslIndex {
  sessions: SessionInfo[];
  errors: Record<string, string>;
  distros: WslDistro[];
}

export interface FsChange {
  root: string;
  dirs: string[];
  paths: string[];
  rescan: boolean;
}

export type TerminalKind = "agent" | "shell";

export type TerminalStatus = "starting" | "running" | "exited" | "error";

export interface TerminalState {
  id: string;
  kind: TerminalKind;
  workspaceId: string;
  cwd: string;
  status: TerminalStatus;
  pid: number | null;
  exitCode: number | null;
  error: string | null;
  busy: boolean;
  attention: boolean;
}

export type WorkspaceMode = "preview" | "live";

export interface ShellTab {
  id: string;
  cwd: string;
  program: string;
}

export interface Workspace {
  id: string;
  sessionId: string;
  cwd: string;
  title: string;
  filePath: string | null;
  agent: AgentId;
  pendingSince: number | null;
  mode: WorkspaceMode;
  agentTerminalId: string | null;
  agentArgs: string[];
  shells: ShellTab[];
  activeShellId: string | null;
  shellPanelOpen: boolean;
  openFiles: string[];
  activeFile: string | null;
}

export type ContextView = "explorer" | "changes" | "agent";

export interface Note {
  id: string;
  text: string;
  modifiedMs: number;
}
