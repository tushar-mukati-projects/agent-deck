import { decodeDiffTab, encodeDiffTab } from "@/lib/diff-tabs";
import { isWithin, joinPath, relativePath, samePath } from "@/lib/utils";

const SEPARATOR = /[\\/]/;
const WINDOWS_ONLY = /[<>:"|?*\u0000-\u001f]/;
const TRAILING_DOT_OR_SPACE = /[. ]$/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

export const entryNameError = (name: string) => {
  if (!name) return "Enter a name.";
  if (name === "." || name === "..") return "That name isn't allowed.";
  if (SEPARATOR.test(name)) return "A name can't contain / or \\.";
  if (WINDOWS_ONLY.test(name)) return 'A name can\'t contain < > : " | ? or *.';
  if (TRAILING_DOT_OR_SPACE.test(name)) return "A name can't end with a dot or a space.";
  if (RESERVED.test(name)) return `${name} is a name Windows reserves.`;
  return null;
};

export const movedPath = (path: string, from: string, to: string) => {
  if (samePath(path, from)) return to;
  return isWithin(path, from) ? joinPath(to, relativePath(path, from)) : path;
};

export const movedTab = (tab: string, from: string, to: string) => {
  const diff = decodeDiffTab(tab);
  return diff
    ? encodeDiffTab({ ...diff, path: movedPath(diff.path, from, to) })
    : movedPath(tab, from, to);
};
