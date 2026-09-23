export interface SessionInfo {
  id: string;
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
}

export interface LiveSession {
  distro: string | null;
  sessionId: string;
  pid: number;
  cwd: string | null;
  status: string | null;
  kind: string | null;
  name: string | null;
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

export type FileContent =
  | { kind: "text"; text: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "tooLarge"; size: number };

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

export interface WslDistro {
  name: string;
  running: boolean;
}

export interface WslIndex {
  sessions: SessionInfo[];
  shells: Record<string, string>;
  errors: Record<string, string>;
}

export interface FsChange {
  root: string;
  dirs: string[];
  paths: string[];
}

export type TerminalKind = "claude" | "shell";

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

export interface Workspace {
  id: string;
  sessionId: string;
  cwd: string;
  title: string;
  filePath: string | null;
  mode: WorkspaceMode;
  claudeTerminalId: string | null;
  activeShellId: string | null;
  shellPanelOpen: boolean;
  openFiles: string[];
  activeFile: string | null;
}

export type SidebarView = "sessions" | "explorer" | "changes";
