import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { ExternalLink, FileQuestion } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, Spinner } from "@/components/ui/feedback";
import { Alert } from "@/components/ui/panel";
import { DiffView } from "@/features/changes/DiffView";
import { McpView } from "@/features/mcp/McpView";
import { FileTabs } from "@/features/viewer/FileTabs";
import { FileToolbar } from "@/features/viewer/FileToolbar";
import { MarkdownView } from "@/features/viewer/MarkdownView";
import { useFileContent } from "@/features/viewer/useFileContent";
import { isTextKind, viewKind } from "@/features/viewer/view-kind";
import { decodeDiffTab, decodeMcpTab } from "@/lib/diff-tabs";
import { api } from "@/lib/tauri/commands";
import { assetUrl, openExternal, revealInExplorer } from "@/lib/tauri/system";
import { basename, dirname, errorMessage, normalizePath } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { useViewerStore } from "@/stores/viewer-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

const CodeView = lazy(() =>
  import("@/features/viewer/CodeView").then((m) => ({ default: m.CodeView })),
);

const Centered = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-full items-center justify-center">{children}</div>
);

const MediaFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-full items-center justify-center overflow-auto bg-[radial-gradient(color-mix(in_srgb,var(--color-fg)_6%,transparent)_1px,transparent_1px)] [background-size:16px_16px] p-6">
    {children}
  </div>
);

const MediaFile = ({ path, kind }: { path: string; kind: "image" | "pdf" | "video" | "audio" }) => {
  const src = assetUrl(path);
  if (kind === "pdf")
    return <iframe title={basename(path)} src={src} className="h-full w-full border-0 bg-white" />;
  return (
    <MediaFrame>
      {kind === "image" && (
        <img
          src={src}
          alt={basename(path)}
          className="max-h-full max-w-full rounded shadow-2xl shadow-black/50"
        />
      )}
      {kind === "video" && <video src={src} controls className="max-h-full max-w-full rounded" />}
      {kind === "audio" && <audio src={src} controls />}
    </MediaFrame>
  );
};

const FileBody = ({ workspace, tab }: { workspace: Workspace; tab: string }) => {
  const diff = useMemo(() => decodeDiffTab(tab), [tab]);
  const serverId = useMemo(() => decodeMcpTab(tab), [tab]);
  if (diff) return <DiffView tab={diff} workspace={workspace} />;
  if (serverId !== null) return <McpView workspace={workspace} serverId={serverId} />;
  return <DocumentBody workspace={workspace} path={tab} />;
};

const DocumentBody = ({ workspace, path }: { workspace: Workspace; path: string }) => {
  const kind = viewKind(path);
  const needsText = isTextKind(kind);
  const { state, reload, staleOnDisk, dismissStale } = useFileContent(path, needsText);
  const key = normalizePath(path);
  const draft = useViewerStore((s) => s.drafts[key]);
  const editing = useViewerStore((s) => !!s.editing[key]);
  const markdownMode = useViewerStore((s) => s.markdownMode[key] ?? "preview");
  const { setDraft, setEditing, setMarkdownMode } = useViewerStore.getState();
  const savingRef = useRef(false);
  const staleRef = useRef(staleOnDisk);
  staleRef.current = staleOnDisk;

  const text =
    state.status === "ready" && state.content.kind === "text" ? state.content.text : null;
  const dirty = draft !== undefined;
  const showSource = kind === "text" || (kind === "markdown" && markdownMode === "source");

  const save = useCallback(async () => {
    const current = useViewerStore.getState().drafts[normalizePath(path)];
    if (current === undefined || savingRef.current) return;
    if (staleRef.current) {
      const overwrite = await useUiStore.getState().askConfirm({
        title: `Overwrite ${basename(path)}?`,
        description:
          "The file changed on disk after you started editing. Saving replaces those changes with yours.",
        confirmLabel: "Overwrite",
        destructive: true,
      });
      if (!overwrite) return;
    }
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

  const discardAndReload = useCallback(() => {
    setDraft(path, null);
    void reload(true);
  }, [path, reload, setDraft]);

  const handleChange = useCallback(
    (value: string) => setDraft(path, value === text ? null : value),
    [path, setDraft, text],
  );

  const openLinked = useCallback(
    async (target: string) => {
      if (await api.pathIsDir(target).catch(() => false)) void revealInExplorer(target);
      else useWorkspaceStore.getState().openFile(workspace.id, target);
    },
    [workspace.id],
  );
  const onOpenPath = useCallback((p: string) => void openLinked(p), [openLinked]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FileToolbar
        workspace={workspace}
        path={path}
        size={state.status === "ready" ? state.content.size : null}
        markdownMode={kind === "markdown" ? markdownMode : null}
        onMarkdownMode={(mode) => setMarkdownMode(path, mode)}
        canEdit={showSource && text !== null}
        editing={editing}
        onToggleEdit={() => setEditing(path, !editing)}
        dirty={dirty}
        onSave={() => void save()}
        onReload={() => (dirty ? discardAndReload() : void reload())}
      />

      {staleOnDisk && dirty && (
        <Alert
          tone="warning"
          className="m-2 mb-0"
          action={
            <>
              <Button size="sm" variant="ghost" onClick={discardAndReload}>
                Reload from disk
              </Button>
              <Button size="sm" variant="ghost" onClick={dismissStale}>
                Keep mine
              </Button>
            </>
          }
        >
          {basename(path)} changed on disk while you were editing.
        </Alert>
      )}

      <div className="min-h-0 flex-1 overflow-hidden bg-code-bg">
        {!needsText && <MediaFile path={path} kind={kind as "image" | "pdf" | "video" | "audio"} />}
        {needsText && state.status === "loading" && (
          <Centered>
            <Spinner />
          </Centered>
        )}
        {needsText && state.status === "error" && (
          <EmptyState
            className="h-full"
            icon={<FileQuestion />}
            title="Couldn't open file"
            description={state.error}
          />
        )}
        {needsText && state.status === "ready" && state.content.kind !== "text" && (
          <EmptyState
            className="h-full"
            icon={<FileQuestion />}
            title={state.content.kind === "binary" ? "Binary file" : "File is too large to preview"}
            description={basename(path)}
            action={
              <Button size="sm" onClick={() => void openExternal(path)}>
                <ExternalLink /> Open with default app
              </Button>
            }
          />
        )}
        {text !== null && !showSource && (
          <div className="h-full overflow-y-auto">
            <div className="mx-auto max-w-[860px] px-8 py-6">
              <MarkdownView
                source={draft ?? text}
                baseDir={dirname(path)}
                onOpenPath={onOpenPath}
              />
            </div>
          </div>
        )}
        {text !== null && showSource && (
          <Suspense
            fallback={
              <Centered>
                <Spinner />
              </Centered>
            }
          >
            <CodeView
              path={path}
              value={draft ?? text}
              editable={editing}
              onChange={handleChange}
              onSave={() => void save()}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
};

export const FileViewer = ({ workspace }: { workspace: Workspace }) => {
  const activeFile = workspace.activeFile ?? workspace.openFiles[0];

  useEffect(() => {
    if (!workspace.activeFile && activeFile)
      useWorkspaceStore.getState().setActiveFile(workspace.id, activeFile);
  }, [workspace.id, workspace.activeFile, activeFile]);

  if (!activeFile) return null;
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <FileTabs workspace={workspace} />
      <FileBody key={activeFile} workspace={workspace} tab={activeFile} />
    </div>
  );
};
