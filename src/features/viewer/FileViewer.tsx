import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import {
  AtSign,
  BookOpen,
  Code2,
  Copy,
  ExternalLink,
  FileQuestion,
  FolderOpen,
  GitCompare,
  Pencil,
  RotateCw,
  Save,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { DiffView } from "@/features/changes/DiffView";
import { MarkdownView } from "@/features/viewer/MarkdownView";
import { decodeDiffTab, isDiffTab } from "@/lib/diff-tabs";
import { useFileContent } from "@/features/viewer/useFileContent";
import { FileIcon } from "@/lib/file-icons";
import { api } from "@/lib/tauri/commands";
import { assetUrl, copyText, openExternal, revealInExplorer } from "@/lib/tauri/system";
import { pasteIntoTerminal } from "@/lib/terminal/registry";
import { basename, cn, dirname, errorMessage, extension, formatBytes, normalizePath, relativePath, samePath } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { useViewerStore } from "@/stores/viewer-store";
import { useWorkspaceStore, type WorkspaceRecord } from "@/stores/workspace-store";

const CodeView = lazy(() => import("@/features/viewer/CodeView").then((m) => ({ default: m.CodeView })));

type ViewKind = "markdown" | "image" | "pdf" | "video" | "audio" | "text";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]);
const VIDEO = new Set(["mp4", "webm", "mov", "m4v"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "m4a", "flac"]);
const MARKDOWN = new Set(["md", "mdx", "markdown"]);

const viewKind = (path: string): ViewKind => {
  const ext = extension(path);
  if (MARKDOWN.has(ext)) return "markdown";
  if (IMAGE.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (VIDEO.has(ext)) return "video";
  if (AUDIO.has(ext)) return "audio";
  return "text";
};

const FileTabs = ({ workspace }: { workspace: WorkspaceRecord }) => {
  const drafts = useViewerStore((s) => s.drafts);
  const { setActiveFile } = useWorkspaceStore.getState();
  return (
    <div className="no-scrollbar flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-panel">
      {workspace.openFiles.map((path) => {
        const active = !!workspace.activeFile && samePath(path, workspace.activeFile);
        const dirty = normalizePath(path) in drafts;
        return (
          <div
            key={path}
            role="tab"
            aria-selected={active}
            title={decodeDiffTab(path)?.path ?? path}
            onClick={() => setActiveFile(workspace.id, path)}
            onMouseDown={(e) => e.button === 1 && void closeFileWithConfirm(workspace.id, path)}
            className={cn(
              "group relative flex max-w-[200px] shrink-0 cursor-default items-center gap-1.5 border-r border-border pr-1 pl-2.5 text-[12px]",
              active ? "bg-bg text-fg" : "text-muted hover:text-fg",
            )}
          >
            {active && <span className="absolute inset-x-0 top-0 h-px bg-accent" />}
            <FileIcon path={decodeDiffTab(path)?.path ?? path} />
            <span className="truncate">{basename(decodeDiffTab(path)?.path ?? path)}</span>
            {isDiffTab(path) && <GitCompare className="size-3 shrink-0 text-faint" />}
            <button
              type="button"
              aria-label="Close file"
              onClick={(e) => {
                e.stopPropagation();
                void closeFileWithConfirm(workspace.id, path);
              }}
              className="flex size-5 items-center justify-center rounded text-faint hover:bg-active hover:text-fg"
            >
              {dirty ? (
                <span className="size-2 rounded-full bg-fg/70 group-hover:hidden" />
              ) : null}
              <X className={cn("size-3", dirty && "hidden group-hover:block", !active && !dirty && "opacity-0 group-hover:opacity-100")} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export const closeFileWithConfirm = async (workspaceId: string, path: string) => {
  const { drafts, setDraft, setEditing } = useViewerStore.getState();
  if (normalizePath(path) in drafts) {
    const confirmed = await useUiStore.getState().askConfirm({
      title: `Discard changes to ${basename(path)}?`,
      description: "Your unsaved edits will be lost.",
      confirmLabel: "Discard",
      destructive: true,
    });
    if (!confirmed) return;
  }
  setDraft(path, null);
  setEditing(path, false);
  useWorkspaceStore.getState().closeFile(workspaceId, path);
};

const MediaFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-full items-center justify-center overflow-auto bg-[radial-gradient(color-mix(in_srgb,var(--color-fg)_6%,transparent)_1px,transparent_1px)] [background-size:16px_16px] p-6">
    {children}
  </div>
);

const FileBody = ({ workspace, path }: { workspace: WorkspaceRecord; path: string }) => {
  const diff = useMemo(() => decodeDiffTab(path), [path]);
  if (diff) return <DiffView tab={diff} workspace={workspace} />;
  return <TextFileBody workspace={workspace} path={path} />;
};

const TextFileBody = ({ workspace, path }: { workspace: WorkspaceRecord; path: string }) => {
  const kind = viewKind(path);
  const needsText = kind === "text" || kind === "markdown";
  const { state, reload } = useFileContent(path, needsText);
  const key = normalizePath(path);
  const draft = useViewerStore((s) => s.drafts[key]);
  const editing = useViewerStore((s) => !!s.editing[key]);
  const markdownMode = useViewerStore((s) => s.markdownMode[key] ?? "preview");
  const { setDraft, setEditing, setMarkdownMode } = useViewerStore.getState();
  const openFile = useWorkspaceStore((s) => s.openFile);
  const savingRef = useRef(false);

  const text = state.status === "ready" && state.content.kind === "text" ? state.content.text : null;

  const save = useCallback(async () => {
    const current = useViewerStore.getState().drafts[normalizePath(path)];
    if (current === undefined || savingRef.current) return;
    savingRef.current = true;
    try {
      await api.writeFile(path, current);
      setDraft(path, null);
      await reload(true);
      toast.success(`Saved ${basename(path)}`);
    } catch (error) {
      toast.error(`Couldn't save: ${errorMessage(error)}`);
    } finally {
      savingRef.current = false;
    }
  }, [path, reload, setDraft]);

  const handleChange = useCallback(
    (value: string) => setDraft(path, value === text ? null : value),
    [path, setDraft, text],
  );

  const openLinked = async (target: string) => {
    if (await api.pathIsDir(target)) {
      void revealInExplorer(target);
      return;
    }
    openFile(workspace.id, target);
  };

  const mention = () => {
    if (!workspace.claudeTerminalId) return;
    pasteIntoTerminal(workspace.claudeTerminalId, `@${relativePath(path, workspace.cwd).replace(/\\/g, "/")} `);
  };

  const showSource = kind === "text" || (kind === "markdown" && markdownMode === "source");
  const dirty = draft !== undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
        <div className="flex min-w-0 flex-1 items-center gap-1 text-[11.5px] text-faint" title={path}>
          {relativePath(path, workspace.cwd)
            .split(/[\\/]/)
            .map((segment, index, all) => (
              <span key={index} className="flex min-w-0 items-center gap-1">
                <span className={cn("truncate", index === all.length - 1 && "text-muted")}>{segment}</span>
                {index < all.length - 1 && <span className="text-border-strong">/</span>}
              </span>
            ))}
          {state.status === "ready" && (
            <span className="ml-2 shrink-0 text-[10.5px] text-faint">{formatBytes(state.content.size)}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {kind === "markdown" && (
            <div className="mr-1 flex rounded-md border border-border p-0.5">
              {(["preview", "source"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setMarkdownMode(path, mode)}
                  className={cn(
                    "flex h-5 items-center gap-1 rounded px-1.5 text-[11px] capitalize",
                    markdownMode === mode ? "bg-active text-fg" : "text-faint hover:text-fg",
                  )}
                >
                  {mode === "preview" ? <BookOpen className="size-3" /> : <Code2 className="size-3" />}
                  {mode}
                </button>
              ))}
            </div>
          )}
          {dirty && (
            <Button size="sm" variant="primary" className="mr-1 h-6" onClick={() => void save()}>
              <Save /> Save
            </Button>
          )}
          {showSource && text !== null && (
            <IconButton
              label={editing ? "Stop editing" : "Edit file"}
              active={editing}
              onClick={() => setEditing(path, !editing)}
            >
              <Pencil />
            </IconButton>
          )}
          <IconButton label="Mention in Claude" disabled={workspace.mode !== "live"} onClick={mention}>
            <AtSign />
          </IconButton>
          <IconButton label="Reload" onClick={() => void reload()}>
            <RotateCw />
          </IconButton>
          <IconButton label="Open in VS Code" onClick={() => void api.openInEditor(path).catch((e) => toast.error(errorMessage(e)))}>
            <Code2 />
          </IconButton>
          <IconButton label="Reveal in File Explorer" onClick={() => void revealInExplorer(path)}>
            <FolderOpen />
          </IconButton>
          <IconButton label="Copy path" onClick={() => void copyText(path).then(() => toast.success("Path copied"))}>
            <Copy />
          </IconButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-code-bg">
        {kind === "image" && (
          <MediaFrame>
            <img src={assetUrl(path)} alt={basename(path)} className="max-h-full max-w-full rounded shadow-2xl shadow-black/50" />
          </MediaFrame>
        )}
        {kind === "pdf" && <iframe title={basename(path)} src={assetUrl(path)} className="h-full w-full border-0 bg-white" />}
        {kind === "video" && (
          <MediaFrame>
            <video src={assetUrl(path)} controls className="max-h-full max-w-full rounded" />
          </MediaFrame>
        )}
        {kind === "audio" && (
          <MediaFrame>
            <audio src={assetUrl(path)} controls />
          </MediaFrame>
        )}
        {needsText && state.status === "loading" && (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        )}
        {needsText && state.status === "error" && (
          <EmptyState className="h-full" icon={<FileQuestion />} title="Couldn't open file" description={state.error} />
        )}
        {needsText && state.status === "ready" && state.content.kind !== "text" && (
          <EmptyState
            className="h-full"
            icon={<FileQuestion />}
            title={state.content.kind === "binary" ? "Binary file" : "File is too large to preview"}
            description={`${basename(path)} · ${formatBytes(state.content.size)}`}
            action={
              <Button size="sm" onClick={() => void openExternal(path)}>
                <ExternalLink /> Open with default app
              </Button>
            }
          />
        )}
        {text !== null && kind === "markdown" && markdownMode === "preview" && (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto max-w-[860px] px-8 py-6">
              <MarkdownView source={draft ?? text} baseDir={dirname(path)} onOpenPath={(p) => void openLinked(p)} />
            </div>
          </div>
        )}
        {text !== null && showSource && (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <CodeView path={path} value={draft ?? text} editable={editing} onChange={handleChange} onSave={() => void save()} />
          </Suspense>
        )}
      </div>
    </div>
  );
};

export const FileViewer = ({ workspace }: { workspace: WorkspaceRecord }) => {
  const activeFile = workspace.activeFile ?? workspace.openFiles[0];

  useEffect(() => {
    if (!workspace.activeFile && activeFile) useWorkspaceStore.getState().setActiveFile(workspace.id, activeFile);
  }, [workspace.id, workspace.activeFile, activeFile]);

  if (!activeFile) return null;
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <FileTabs workspace={workspace} />
      <FileBody key={activeFile} workspace={workspace} path={activeFile} />
    </div>
  );
};
