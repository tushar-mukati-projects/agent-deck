import { isWithin } from "@/lib/utils";

const SEPARATOR = /[\\/]/;

export const entryNameError = (name: string) => {
  if (!name) return "Enter a name.";
  if (SEPARATOR.test(name)) return "A name can't contain / or \\.";
  if (name === "." || name === "..") return "That name isn't allowed.";
  return null;
};

export const movedPath = (path: string, from: string, to: string) =>
  isWithin(path, from) ? `${to}${path.slice(from.length)}` : path;
