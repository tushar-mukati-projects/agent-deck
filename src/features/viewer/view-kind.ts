import { extension } from "@/lib/utils";

export type ViewKind = "markdown" | "image" | "pdf" | "video" | "audio" | "text";

const KINDS: Record<Exclude<ViewKind, "text">, Set<string>> = {
  markdown: new Set(["md", "mdx", "markdown"]),
  image: new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]),
  pdf: new Set(["pdf"]),
  video: new Set(["mp4", "webm", "mov", "m4v"]),
  audio: new Set(["mp3", "wav", "ogg", "m4a", "flac"]),
};

export const viewKind = (path: string): ViewKind => {
  const ext = extension(path);
  const match = (Object.entries(KINDS) as [ViewKind, Set<string>][]).find(([, exts]) =>
    exts.has(ext),
  );
  return match?.[0] ?? "text";
};

export const isTextKind = (kind: ViewKind) => kind === "text" || kind === "markdown";
