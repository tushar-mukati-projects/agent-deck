import { Channel, invoke } from "@tauri-apps/api/core";

import type {
  AppEnvironment,
  ChangedFile,
  GitChange,
  DirEntry,
  FileContent,
  LiveSession,
  MediaIndex,
  ProjectAgent,
  SearchHit,
  TaskPackage,
  PtyEvent,
  PtyInfo,
  SessionInfo,
  SpawnRequest,
  TranscriptItem,
  WslDistro,
  WslIndex,
} from "@/types";

const createChannel = (onEvent: (event: PtyEvent) => void) => {
  const channel = new Channel<PtyEvent>();
  channel.onmessage = onEvent;
  return channel;
};

export const api = {
  environment: () => invoke<AppEnvironment>("environment"),
  listSessions: () => invoke<SessionInfo[]>("list_sessions"),
  liveSessions: () => invoke<LiveSession[]>("live_sessions"),
  sessionTranscript: (filePath: string, distro: string | null) =>
    invoke<TranscriptItem[]>("session_transcript", { filePath, distro }),
  deleteSession: (filePath: string, distro: string | null) =>
    invoke<void>("delete_session", { filePath, distro }),
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
  projectTasks: (root: string) => invoke<TaskPackage[]>("project_tasks", { root }),
  projectAgents: (root: string) => invoke<ProjectAgent[]>("project_agents", { root }),
  projectMedia: (root: string) => invoke<MediaIndex>("project_media", { root }),
  setAttentionBadge: (active: boolean) => invoke<void>("set_attention_badge", { active }),
  listWslSessions: () => invoke<WslIndex>("list_wsl_sessions"),
  wslDistros: () => invoke<WslDistro[]>("wsl_distros"),
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
  writeFile: (path: string, contents: string) => invoke<void>("write_file", { path, contents }),
  listFiles: (root: string) => invoke<string[]>("list_files", { root }),
  pathIsDir: (path: string) => invoke<boolean>("path_is_dir", { path }),
  openInEditor: (path: string) => invoke<void>("open_in_editor", { path }),
  watchDir: (root: string) => invoke<void>("watch_dir", { root }),
  unwatchDir: (root: string) => invoke<void>("unwatch_dir", { root }),
};
