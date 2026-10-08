import { Channel, invoke } from "@tauri-apps/api/core";

import type {
  AgentOverview,
  AgentTask,
  AppEnvironment,
  ChangedFile,
  ConfigAgent,
  ConfigRemoval,
  GitChange,
  DirEntry,
  FileContent,
  FileEncoding,
  FileTail,
  LiveSession,
  McpDescription,
  PathStat,
  PgInfo,
  PgOutput,
  SearchHit,
  PtyEvent,
  PtyInfo,
  SessionInfo,
  SpawnRequest,
  TranscriptPage,
  WriteOutcome,
  WslIndex,
} from "@/types";

export interface WriteOptions {
  encoding?: FileEncoding;
  expectedModifiedMs?: number | null;
}

const createChannel = (onEvent: (event: PtyEvent) => void) => {
  const channel = new Channel<PtyEvent>();
  channel.onmessage = onEvent;
  return channel;
};

export const api = {
  environment: () => invoke<AppEnvironment>("environment"),
  listSessions: () => invoke<SessionInfo[]>("list_sessions"),
  liveSessions: () => invoke<LiveSession[]>("live_sessions"),
  sessionTranscript: (filePath: string, distro: string | null, fromOffset = 0) =>
    invoke<TranscriptPage>("session_transcript", { filePath, distro, fromOffset }),
  deleteSession: (filePath: string, distro: string | null) =>
    invoke<void>("delete_session", { filePath, distro }),
  terminateLiveSession: ({ sessionId, pid, distro }: LiveSession) =>
    invoke<void>("terminate_live_session", { sessionId, pid, distro }),
  sessionTasks: (filePath: string, distro: string | null) =>
    invoke<AgentTask[]>("session_tasks", { filePath, distro }),
  sessionChanges: (filePath: string, distro: string | null) =>
    invoke<ChangedFile[]>("session_changes", { filePath, distro }),
  sessionBackup: (filePath: string, backup: string, distro: string | null) =>
    invoke<string>("session_backup", { filePath, backup, distro }),
  gitStatus: (root: string) => invoke<GitChange[]>("git_status", { root }),
  gitHeadFile: (path: string) => invoke<string>("git_head_file", { path }),
  renameSession: (filePath: string, distro: string | null, title: string) =>
    invoke<void>("rename_session", { filePath, distro, title }),
  searchSessions: (query: string, includeWsl: boolean) =>
    invoke<SearchHit[]>("search_sessions", { query, includeWsl }),
  agentOverview: (cwd: string, agent: ConfigAgent) =>
    invoke<AgentOverview>("agent_overview", { cwd, agent }),
  removeAgentConfig: (cwd: string, agent: ConfigAgent, removal: ConfigRemoval) =>
    invoke<void>("remove_agent_config", { cwd, agent, removal }),
  createMemoryFile: (path: string) => invoke<void>("create_memory_file", { path }),
  mcpDescribe: (cwd: string, id: string) => invoke<McpDescription>("mcp_describe", { cwd, id }),
  mcpCall: (cwd: string, id: string, tool: string, args: unknown) =>
    invoke<unknown>("mcp_call", { cwd, id, tool, arguments: args }),
  mcpReadResource: (cwd: string, id: string, uri: string) =>
    invoke<unknown>("mcp_read_resource", { cwd, id, uri }),
  mcpDisconnect: (cwd: string, id: string) => invoke<void>("mcp_disconnect", { cwd, id }),
  pgInfo: (cwd: string, id: string) => invoke<PgInfo>("pg_info", { cwd, id }),
  pgQuery: (cwd: string, id: string, sql: string) => invoke<PgOutput>("pg_query", { cwd, id, sql }),
  pgCancel: (cwd: string, id: string) => invoke<void>("pg_cancel", { cwd, id }),
  setAttentionBadge: (active: boolean) => invoke<void>("set_attention_badge", { active }),
  applyHideMode: (enabled: boolean) => invoke<string | null>("apply_hide_mode", { enabled }),
  listWslSessions: () => invoke<WslIndex>("list_wsl_sessions"),
  wslStart: (distro: string) => invoke<void>("wsl_start", { distro }),

  ptySpawn: (request: SpawnRequest, onEvent: (event: PtyEvent) => void) =>
    invoke<PtyInfo>("pty_spawn", { request, onEvent: createChannel(onEvent) }),
  ptyAttach: (id: string, onEvent: (event: PtyEvent) => void) =>
    invoke<PtyInfo>("pty_attach", { id, onEvent: createChannel(onEvent) }),
  ptyWrite: (id: string, data: string) => invoke<void>("pty_write", { id, data }),
  ptyResize: (id: string, cols: number, rows: number) =>
    invoke<void>("pty_resize", { id, cols, rows }),
  ptyKill: (id: string) => invoke<void>("pty_kill", { id }),
  ptyList: () => invoke<PtyInfo[]>("pty_list"),

  listDir: (path: string) => invoke<DirEntry[]>("list_dir", { path }),
  readFile: (path: string) => invoke<FileContent>("read_file", { path }),
  writeFile: (path: string, contents: string, options: WriteOptions = {}) =>
    invoke<WriteOutcome>("write_file", {
      path,
      contents,
      encoding: options.encoding ?? null,
      expectedModifiedMs: options.expectedModifiedMs ?? null,
    }),
  statPath: (path: string) => invoke<PathStat | null>("stat_path", { path }),
  readTail: (path: string, maxBytes: number) => invoke<FileTail>("read_tail", { path, maxBytes }),
  listFiles: (root: string) => invoke<string[]>("list_files", { root }),
  openInEditor: (path: string) => invoke<void>("open_in_editor", { path }),
  openPath: (path: string) => invoke<void>("open_path", { path }),
  revealPath: (path: string) => invoke<void>("reveal_path", { path }),
  watchDir: (root: string) => invoke<void>("watch_dir", { root }),
  unwatchDir: (root: string) => invoke<void>("unwatch_dir", { root }),
};
