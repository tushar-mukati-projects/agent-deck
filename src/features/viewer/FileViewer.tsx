import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { ExternalLink, FileQuestion, FileWarning } from "lucide-react";
import { toast } from "sonner";

import { closeFileWithConfirm, openTypedPath } from "@/actions/files";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/feedback";
import { Alert } from "@/components/ui/panel";
import { DiffView } from "@/features/changes/DiffView";
import { McpView } from "@/features/mcp/McpView";
import { FileTabs } from "@/features/viewer/FileTabs";
import { FileToolbar } from "@/features/viewer/FileToolbar";
import { MarkdownView } from "@/features/viewer/MarkdownView";
import { useFileContent, useFileVersion } from "@/features/viewer/useFileContent";
import { isTextKind, viewKind, type ViewKind } from "@/features/viewer/view-kind";
import { decodeDiffTab, decodeMcpTab } from "@/lib/diff-tabs";
import { api } from "@/lib/tauri/commands";
import { assetUrl, openExternal } from "@/lib/tauri/system";
import { basename, dirname, errorMessage, normalizePath, samePath } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import { useViewerStore } from "@/stores/viewer-store";
import { findWorkspace, useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

const CodeView = lazy(() =>
  import("@/features/viewer/CodeView").then((m) => ({ default: m.CodeView })),
);

type MediaKind = Exclude<ViewKind, "text" | "markdown">;

const showError = (error: unknown) => toast.error(errorMessage(error));

const MediaFrame = ({ children }: { children: React.ReactNode }) => (
  <div className="flex h-full items-center justify-center overflow-auto bg-[radial-gradient(color-mix(in_srgb,var(--color-fg)_6%,transparent)_1px,transparent_1px)] [background-size:16px_16px] p-6">
    {children}
  </div>
);

const MediaFile = ({ path, kind }: { path: string; kind: MediaKind }) => {
  const version = useFileVersion(path);
  const src = version ? `${assetUrl(path)}?v=${version}` : assetUrl(path);
  if (kind === "pdf")
    return <iframe title={basename(path)} src={src} className="h-full w-full border-0 bg-white" />;
  return (
    <MediaFrame>
      {kind === "image" && (
        <img
          src={src}
          alt={basename(path)}
          className="max-h-full max-w-full rounded shadow-2xl shadow-shadow"
        />
      )}
      {kind === "video" && <video src={src} controls className="max-h-full max-w-full rounded" />}
      {kind === "audio" && <audio src={src} controls />}
    </MediaFrame>
  );
};

const confirmDiscard = (path: string) =>
  useUiStore.getState().askConfirm({
    title: `Discard changes to ${basename(path)}?`,
    description: "Reloading replaces your unsaved edits with the file on disk.",
    confirmLabel: "Discard and reload",
    destructive: true,
  });

const confirmOverwrite = (path: string) =>
  useUiStore.getState().askConfirm({
    title: `Overwrite ${basename(path)}?`,
    description:
      "The file changed on disk after you started editing. Saving replaces those changes with yours.",
    confirmLabel: "Overwrite",
    destructive: true,
  });

const DocumentBody = ({ workspace, path }: { workspace: Workspace; path: string }) => {
  const kind = viewKind(path);
  const needsText = isTextKind(kind);
  const { state, reload, staleOnDisk, dismissStale } = useFileContent(path, needsText);
  const key = normalizePath(path);
  const draft = useViewerStore((s) => s.drafts[key]);
  const editing = useViewerStore((s) => !!s.editing[key]);
  const markdownMode = useViewerStore((s) => s.markdownMode[key] ?? "preview");
  const line = useViewerStore((s) => s.lines[key] ?? null);
  const { setDraft, setEditing, setMarkdownMode } = useViewerStore.getState();
  const savingRef = useRef(false);

  const content = state.status === "ready" && state.content.kind === "text" ? state.content : null;
  const contentRef = useRef(content);
  contentRef.current = content;
  const text = content?.text ?? null;
  const readOnly = content?.encoding === "lossy";
  const dirty = draft !== undefined;
  const showSource = kind === "text" || (kind === "markdown" && markdownMode === "source");

  useEffect(() => {
    if (line && kind === "markdown" && markdownMode !== "source") setMarkdownMode(path, "source");
  }, [line, kind, markdownMode, path, setMarkdownMode]);

  const clearLine = useCallback(() => void useViewerStore.getState().takeLine(path), [path]);

  const save = useCallback(async () => {
    const current = useViewerStore.getState().drafts[key];
    const base = contentRef.current;
    if (current === undefined || !base || base.encoding === "lossy" || savingRef.current) return;
    savingRef.current = true;
    try {
      const write = (expectedModifiedMs: number | null) =>
        api.writeFile(path, current, { encoding: base.encoding, expectedModifiedMs });
      const outcome = await write(base.modifiedMs);
      if (outcome.kind === "conflict") {
        if (!(await confirmOverwrite(path))) return;
        await write(null);
      }
      await reload(true);
      if (useViewerStore.getState().drafts[key] === current) setDraft(path, null);
      toast.success(`Saved ${basename(path)}`);
    } catch (error) {
      toast.error(`Couldn't save: ${errorMessage(error)}`);
    } finally {
      savingRef.current = false;
    }
  }, [key, path, reload, setDraft]);

  const discardAndReload = useCallback(async () => {
    setDraft(path, null);
    await reload(true);
  }, [path, reload, setDraft]);

  const reloadWithConfirm = async () => {
    if (!dirty) return reload();
    if (await confirmDiscard(path)) await discardAndReload();
  };

  const textRef = useRef(text);
  textRef.current = text;
  const handleChange = useCallback(
    (value: string) => setDraft(path, value === textRef.current ? null : value),
    [path, setDraft],
  );

  const workspaceId = workspace.id;
  const onOpenPath = useCallback(
    (target: string) => {
      const current = findWorkspace(workspaceId);
      if (current) void openTypedPath(current, target);
    },
    [workspaceId],
  );

  const body = () => {
    if (!needsText) return <MediaFile path={path} kind={kind as MediaKind} />;
    if (state.status === "loading") return <LoadingState className="h-full" />;
    if (state.status === "error")
      return (
        <EmptyState
          className="h-full"
          icon={<FileQuestion />}
          title="Couldn't open file"
          description={state.error}
        />
      );
    if (text === null)
      return (
        <EmptyState
          className="h-full"
          icon={<FileQuestion />}
          title={state.content.kind === "binary" ? "Binary file" : "File is too large to preview"}
          description={basename(path)}
          action={
            <Button size="sm" onClick={() => void openExternal(path).catch(showError)}>
              <ExternalLink /> Open with default app
            </Button>
          }
        />
      );
    if (!showSource)
      return (
        <div className="h-full overflow-y-auto">
          <div className="mx-auto max-w-[860px] px-8 py-6">
            <MarkdownView source={draft ?? text} baseDir={dirname(path)} onOpenPath={onOpenPath} />
          </div>
        </div>
      );
    return (
      <Suspense fallback={<LoadingState className="h-full" />}>
        <CodeView
          path={path}
          value={draft ?? text}
          editable={editing && !readOnly}
          line={line}
          onLineShown={clearLine}
          onChange={handleChange}
          onSave={() => void save()}
        />
      </Suspense>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FileToolbar
        workspace={workspace}
        path={path}
        size={state.status === "ready" ? state.content.size : null}
        markdownMode={kind === "markdown" ? markdownMode : null}
        onMarkdownMode={(mode) => setMarkdownMode(path, mode)}
        canEdit={showSource && text !== null && !readOnly}
        editing={editing}
        onToggleEdit={() => setEditing(path, !editing)}
        dirty={dirty}
        onSave={() => void save()}
        onReload={() => void reloadWithConfirm()}
      />

      {readOnly && (
        <Alert tone="info" className="m-2 mb-0">
          {basename(path)} isn't valid text in a known encoding, so it opens read-only to keep its
          bytes intact.
        </Alert>
      )}

      {staleOnDisk && dirty && (
        <Alert
          tone="warning"
          className="m-2 mb-0"
          action={
            <>
              <Button size="sm" variant="ghost" onClick={() => void discardAndReload()}>
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

      <div className="min-h-0 flex-1 overflow-hidden bg-code-bg">{body()}</div>
    </div>
  );
};

const TabBoundary = ({
  workspace,
  tab,
  children,
}: {
  workspace: Workspace;
  tab: string;
  children: React.ReactNode;
}) => (
  <ErrorBoundary
    key={tab}
    fallback={(error, reset) => (
      <EmptyState
        className="h-full"
        icon={<FileWarning />}
        title="This tab ran into a problem"
        description={error.message}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={reset}>
              Try again
            </Button>
            <Button size="sm" onClick={() => void closeFileWithConfirm(workspace.id, tab)}>
              Close tab
            </Button>
          </div>
        }
      />
    )}
  >
    {children}
  </ErrorBoundary>
);

const FileBody = ({ workspace, tab }: { workspace: Workspace; tab: string }) => {
  const diff = useMemo(() => decodeDiffTab(tab), [tab]);
  if (diff) return <DiffView tab={diff} workspace={workspace} />;
  return <DocumentBody workspace={workspace} path={tab} />;
};

export const FileViewer = ({ workspace }: { workspace: Workspace }) => {
  const activeFile = workspace.activeFile ?? workspace.openFiles[0];
  const serverTabs = workspace.openFiles.filter((tab) => decodeMcpTab(tab) !== null);
  const activeIsServer = !!activeFile && decodeMcpTab(activeFile) !== null;

  useEffect(() => {
    if (!workspace.activeFile && activeFile)
      useWorkspaceStore.getState().setActiveFile(workspace.id, activeFile);
  }, [workspace.id, workspace.activeFile, activeFile]);

  if (!activeFile) return null;
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <FileTabs workspace={workspace} />
      {serverTabs.map((tab) => (
        <div
          key={tab}
          className={samePath(tab, activeFile) ? "flex min-h-0 flex-1 flex-col" : "hidden"}
        >
          <TabBoundary workspace={workspace} tab={tab}>
            <McpView workspace={workspace} serverId={decodeMcpTab(tab)!} />
          </TabBoundary>
        </div>
      ))}
      {!activeIsServer && (
        <TabBoundary workspace={workspace} tab={activeFile}>
          <FileBody key={activeFile} workspace={workspace} tab={activeFile} />
        </TabBoundary>
      )}
    </div>
  );
};
