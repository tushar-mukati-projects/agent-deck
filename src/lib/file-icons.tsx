import {
  Braces,
  File,
  FileArchive,
  FileAudio,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileLock2,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  Folder,
  FolderGit2,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";

import { basename, DOCKERFILE_NAME, extension } from "@/lib/utils";

type FileIconProps = {
  path: string;
  isDir?: boolean;
  className?: string;
};

interface IconSpec {
  icon: LucideIcon;
  color: string;
}

const byExtension: Record<string, IconSpec> = {
  ts: { icon: FileCode2, color: "text-[var(--icon-blue)]" },
  tsx: { icon: FileCode2, color: "text-[var(--icon-blue)]" },
  js: { icon: FileCode2, color: "text-[var(--icon-yellow)]" },
  jsx: { icon: FileCode2, color: "text-[var(--icon-yellow)]" },
  mjs: { icon: FileCode2, color: "text-[var(--icon-yellow)]" },
  cjs: { icon: FileCode2, color: "text-[var(--icon-yellow)]" },
  py: { icon: FileCode2, color: "text-[var(--icon-blue)]" },
  rs: { icon: FileCode2, color: "text-[var(--icon-orange)]" },
  go: { icon: FileCode2, color: "text-[var(--icon-cyan)]" },
  java: { icon: FileCode2, color: "text-[var(--icon-red)]" },
  kt: { icon: FileCode2, color: "text-[var(--icon-purple)]" },
  cs: { icon: FileCode2, color: "text-[var(--icon-green)]" },
  cpp: { icon: FileCode2, color: "text-[var(--icon-blue)]" },
  c: { icon: FileCode2, color: "text-[var(--icon-blue)]" },
  h: { icon: FileCode2, color: "text-[var(--icon-purple)]" },
  swift: { icon: FileCode2, color: "text-[var(--icon-orange)]" },
  rb: { icon: FileCode2, color: "text-[var(--icon-red)]" },
  php: { icon: FileCode2, color: "text-[var(--icon-purple)]" },
  html: { icon: FileCode2, color: "text-[var(--icon-orange)]" },
  css: { icon: FileType, color: "text-[var(--icon-blue)]" },
  scss: { icon: FileType, color: "text-[var(--icon-purple)]" },
  vue: { icon: FileCode2, color: "text-[var(--icon-green)]" },
  svelte: { icon: FileCode2, color: "text-[var(--icon-orange)]" },
  json: { icon: FileJson, color: "text-[var(--icon-yellow)]" },
  jsonl: { icon: FileJson, color: "text-[var(--icon-yellow)]" },
  yaml: { icon: Braces, color: "text-[var(--icon-red)]" },
  yml: { icon: Braces, color: "text-[var(--icon-red)]" },
  toml: { icon: FileCog, color: "text-muted" },
  ini: { icon: FileCog, color: "text-muted" },
  env: { icon: FileCog, color: "text-[var(--icon-yellow)]" },
  md: { icon: FileText, color: "text-[var(--icon-blue)]" },
  mdx: { icon: FileText, color: "text-[var(--icon-blue)]" },
  txt: { icon: FileText, color: "text-muted" },
  log: { icon: FileText, color: "text-faint" },
  sh: { icon: FileTerminal, color: "text-[var(--icon-green)]" },
  ps1: { icon: FileTerminal, color: "text-[var(--icon-blue)]" },
  bat: { icon: FileTerminal, color: "text-[var(--icon-green)]" },
  cmd: { icon: FileTerminal, color: "text-[var(--icon-green)]" },
  png: { icon: FileImage, color: "text-[var(--icon-purple)]" },
  jpg: { icon: FileImage, color: "text-[var(--icon-purple)]" },
  jpeg: { icon: FileImage, color: "text-[var(--icon-purple)]" },
  gif: { icon: FileImage, color: "text-[var(--icon-purple)]" },
  webp: { icon: FileImage, color: "text-[var(--icon-purple)]" },
  svg: { icon: FileImage, color: "text-[var(--icon-yellow)]" },
  ico: { icon: FileImage, color: "text-[var(--icon-purple)]" },
  mp4: { icon: FileVideo, color: "text-[var(--icon-red)]" },
  webm: { icon: FileVideo, color: "text-[var(--icon-red)]" },
  mov: { icon: FileVideo, color: "text-[var(--icon-red)]" },
  mp3: { icon: FileAudio, color: "text-[var(--icon-cyan)]" },
  wav: { icon: FileAudio, color: "text-[var(--icon-cyan)]" },
  zip: { icon: FileArchive, color: "text-[var(--icon-yellow)]" },
  gz: { icon: FileArchive, color: "text-[var(--icon-yellow)]" },
  "7z": { icon: FileArchive, color: "text-[var(--icon-yellow)]" },
  csv: { icon: FileSpreadsheet, color: "text-[var(--icon-green)]" },
  xlsx: { icon: FileSpreadsheet, color: "text-[var(--icon-green)]" },
  pdf: { icon: FileText, color: "text-[var(--icon-red)]" },
  lock: { icon: FileLock2, color: "text-faint" },
};

const byName: Record<string, IconSpec> = {
  "package.json": { icon: FileJson, color: "text-[var(--icon-green)]" },
  "cargo.toml": { icon: FileCog, color: "text-[var(--icon-orange)]" },
  "claude.md": { icon: FileText, color: "text-accent" },
  dockerfile: { icon: FileCog, color: "text-[var(--icon-blue)]" },
  ".gitignore": { icon: FileCog, color: "text-faint" },
};

export const fileIcon = (path: string): IconSpec => {
  const name = basename(path).toLowerCase();
  if (name.startsWith(".env")) return byExtension.env;
  if (DOCKERFILE_NAME.test(name)) return byName.dockerfile;
  return byName[name] ?? byExtension[extension(path)] ?? { icon: File, color: "text-faint" };
};

export const folderIcon = (name: string, open: boolean): IconSpec => {
  if (name === ".git") return { icon: FolderGit2, color: "text-faint" };
  return {
    icon: open ? FolderOpen : Folder,
    color: name.startsWith(".") ? "text-faint" : "text-folder",
  };
};

export const FileIcon = ({ path, isDir, className }: FileIconProps) => {
  const { icon: Icon, color } = isDir ? folderIcon(basename(path), false) : fileIcon(path);
  return <Icon className={`${color} ${className ?? "size-3.5 shrink-0"}`} />;
};
