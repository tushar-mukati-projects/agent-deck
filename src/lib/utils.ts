import { clsx, type ClassValue } from "clsx";
import { formatDistanceToNowStrict } from "date-fns";
import { twMerge } from "tailwind-merge";

import { parseWslPath, wslDisplayPath } from "@/lib/wsl";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const trimTrailingSeparators = (path: string) => path.replace(/[\\/]+$/, "");

const unifySeparators = (path: string) => trimTrailingSeparators(path).replace(/\//g, "\\");

const WSL_ROOT = /^\\\\wsl(?:\$|\.localhost)\\([^\\]*)(.*)$/i;

export const normalizePath = (path: string) => {
  const unified = unifySeparators(path);
  const wsl = WSL_ROOT.exec(unified);
  return wsl ? `\\\\wsl.localhost\\${wsl[1].toLowerCase()}${wsl[2]}` : unified.toLowerCase();
};

export const samePath = (a: string, b: string) => normalizePath(a) === normalizePath(b);

export const isWithin = (child: string, parent: string) => {
  const c = normalizePath(child);
  const p = normalizePath(parent);
  return c === p || c.startsWith(`${p}\\`);
};

export const basename = (path: string) => {
  const parts = trimTrailingSeparators(path).split(/[\\/]/);
  return parts[parts.length - 1] || path;
};

export const dirname = (path: string) => {
  const trimmed = trimTrailingSeparators(path);
  const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  return index <= 0 ? trimmed : trimmed.slice(0, index);
};

export const joinPath = (base: string, relative: string) =>
  `${trimTrailingSeparators(base)}\\${relative.replace(/^[\\/]+/, "").replace(/\//g, "\\")}`;

export const resolvePath = (baseDir: string, relative: string) => {
  const parts = trimTrailingSeparators(baseDir).split(/[\\/]/);
  for (const segment of relative.split(/[\\/]/)) {
    if (!segment || segment === ".") continue;
    if (segment !== "..") parts.push(segment);
    else if (parts.length > 1) parts.pop();
  }
  return parts.join("\\");
};

export const relativePath = (path: string, root: string) =>
  isWithin(path, root) && !samePath(path, root)
    ? unifySeparators(path).split("\\").slice(normalizePath(root).split("\\").length).join("\\")
    : path;

export const DOCKERFILE_NAME = /^(docker|container)file([.-].+)?$|[.-](docker|container)file$/i;

export const extension = (path: string) => {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
};

export const shortenHome = (path: string, home: string) => {
  const wsl = parseWslPath(path);
  if (wsl) return wslDisplayPath(wsl);
  return home && isWithin(path, home)
    ? `~${path.slice(trimTrailingSeparators(home).length)}`
    : path;
};

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (Math.round(value) >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const tenths = value.toFixed(1);
  return `${Number(tenths) >= 10 ? value.toFixed(0) : tenths} ${units[unit]}`;
};

export const timeAgo = (ms: number) => {
  if (Date.now() - ms < 45_000) return "just now";
  return formatDistanceToNowStrict(ms, { addSuffix: true })
    .replace(/ seconds?/, "s")
    .replace(/ minutes?/, "m")
    .replace(/ hours?/, "h")
    .replace(/ days?/, "d")
    .replace(/ months?/, "mo")
    .replace(/ years?/, "y");
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const SHORT_UNITS: [number, string][] = [
  [365 * DAY, "y"],
  [30 * DAY, "mo"],
  [7 * DAY, "w"],
  [DAY, "d"],
  [60 * MINUTE, "h"],
  [MINUTE, "m"],
];

export const shortTimeAgo = (ms: number, now = Date.now()) => {
  const elapsed = Math.max(0, now - ms);
  const unit = SHORT_UNITS.find(([size]) => elapsed >= size);
  return unit ? `${Math.floor(elapsed / unit[0])}${unit[1]}` : "now";
};

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

export const toggled = <T>(set: ReadonlySet<T>, value: T) => {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
};

export const newId = () => crypto.randomUUID();

export const omitKey = <T>(record: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in record)) return record;
  const { [key]: _omitted, ...rest } = record;
  return rest;
};

export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Something went wrong";
