import { basename, dirname, joinPath, relativePath } from "@/lib/utils";

export interface ChangeFolder<T> {
  kind: "folder";
  key: string;
  name: string;
  path: string;
  children: ChangeNode<T>[];
}

interface ChangeFile<T> {
  kind: "file";
  key: string;
  item: T;
}

export type ChangeNode<T> = ChangeFolder<T> | ChangeFile<T>;

const label = (node: ChangeNode<unknown>) =>
  node.kind === "folder" ? node.name : basename(node.key);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const foldersFirstByName = (a: ChangeNode<unknown>, b: ChangeNode<unknown>) => {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return collator.compare(label(a), label(b));
};

const sortAndCompact = <T>(folder: ChangeFolder<T>): ChangeFolder<T> => {
  const children = folder.children
    .map((child) => (child.kind === "folder" ? sortAndCompact(child) : child))
    .sort(foldersFirstByName);
  const only = children.length === 1 ? children[0] : null;
  if (folder.key && only?.kind === "folder")
    return { ...only, name: `${folder.name}/${only.name}` };
  return { ...folder, children };
};

const childFolder = <T>(parent: ChangeFolder<T>, name: string, path: string) => {
  const key = parent.key ? `${parent.key}\\${name}` : name;
  const existing = parent.children.find(
    (child): child is ChangeFolder<T> => child.kind === "folder" && child.key === key,
  );
  if (existing) return existing;
  const folder: ChangeFolder<T> = { kind: "folder", key, name, path, children: [] };
  parent.children.push(folder);
  return folder;
};

export const buildChangeTree = <T>(items: T[], pathOf: (item: T) => string, root: string) => {
  const top: ChangeFolder<T> = { kind: "folder", key: "", name: "", path: root, children: [] };
  for (const item of items) {
    const path = pathOf(item);
    const rel = relativePath(path, root);
    let folder = top;
    if (rel === path) {
      folder = childFolder(top, dirname(path), dirname(path));
    } else {
      for (const name of rel.split("\\").slice(0, -1))
        folder = childFolder(folder, name, joinPath(folder.path, name));
    }
    folder.children.push({ kind: "file", key: path, item });
  }
  return sortAndCompact(top).children;
};
