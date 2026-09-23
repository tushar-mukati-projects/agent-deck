import { clsx, type ClassValue } from "clsx";
import { formatDistanceToNowStrict } from "date-fns";
import { twMerge } from "tailwind-merge";

import { parseWslPath, wslDisplayPath } from "@/lib/wsl";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const trimTrailingSeparators = (path: string) => path.replace(/[\\/]+$/, "");

export const normalizePath = (path: string) =>
  trimTrailingSeparators(path).replace(/\//g, "\\").toLowerCase();

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
    ? path.slice(trimTrailingSeparators(root).length + 1)
    : path;

export const extension = (path: string) => {
  const name = basename(path);
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
};

export const shortenHome = (path: string, home: string) => {
  const wsl = parseWslPath(path);
  if (wsl) return wslDisplayPath(wsl);
  return home && isWithin(path, home) ? `~${path.slice(trimTrailingSeparators(home).length)}` : path;
};

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
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

export const newId = () => crypto.randomUUID();

export const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : "Something went wrong";
