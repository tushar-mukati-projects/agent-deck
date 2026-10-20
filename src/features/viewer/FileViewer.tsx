import { useCallback, useEffect, useMemo, useRef } from "react";
import { ExternalLink, FileQuestion, FileWarning } from "lucide-react";

import {
  closeFilesWithConfirm,
  discardAndReload,
  openPathInWorkspace,
  reloadWithConfirm,
  saveFile,
} from "@/actions/files";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, showError } from "@/components/ui/feedback";
import { DiffView } from "@/features/changes/DiffView";
import { McpView } from "@/features/mcp/McpView";
import { CodeView } from "@/features/viewer/CodeView";
import { FileTabs } from "@/features/viewer/FileTabs";
import { FileToolbar } from "@/features/viewer/FileToolbar";
import { MarkdownView } from "@/features/viewer/MarkdownView";
import { useFileContent, useFileVersion } from "@/features/viewer/useFileContent";
import { decodeDiffTab, decodeMcpTab } from "@/lib/diff-tabs";
import { assetUrl, openExternal } from "@/lib/tauri/system";
import { basename, dirname, normalizePath, samePath } from "@/lib/utils";
import { isTextKind, viewKind, type ViewKind } from "@/lib/view-kind";
import { useViewerStore } from "@/stores/viewer-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

type MediaKind = Exclude<ViewKind, "text" | "markdown">;

type MediaFrameProps = {
  children: React.ReactNode;
};

const MediaFrame = ({ children }: MediaFrameProps) => (
  <div className="flex h-full items-center justify-center overflow-auto bg-[radial-gradient(color-mix(in_srgb,var(--color-fg)_6%,transparent)_1px,transparent_1px)] [background-size:16px_16px] p-6">
    {children}
  </div>
);

type MediaFileProps = {
  path: string;
  kind: MediaKind;
};

const MediaFile = ({ path, kind }: MediaFileProps) => {
  const version = useFileVersion(path);
  const src = version ? `${assetUrl(path)}?v=${version}` : assetUrl(path);
  if (kind === "pdf")
    return <iframe title={basename(path)} src={src} className="h-full w-full border-0 bg-paper" />;
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

type DocumentBodyProps = {
  workspace: Workspace;
  path: string;
};

const DocumentBody = ({ workspace, path }: DocumentBodyProps) => {
  const kind = viewKind(path);
  const needsText = isTextKind(kind);
  const { state, reload, staleOnDisk, dismissStale } = useFileContent(path, needsText);
  const key = normalizePath(path);
  const dirty = useViewerStore((s) => key in s.drafts);
  const draft = useViewerStore.getState().drafts[key];
  const editing = useViewerStore((s) => !!s.editing[key]);
  const markdownMode = useViewerStore((s) => s.markdownMode[key] ?? "preview");
  const line = useViewerStore((s) => s.lines[key] ?? null);
  const { setDraft, setEditing, setMarkdownMode } = useViewerStore.getState();

  const content = state.status === "ready" && state.content.kind === "text" ? state.content : null;
  const contentRef = useRef(content);
  contentRef.current = content;
  const text = content?.text ?? null;
  const readOnly = content?.encoding === "lossy";
  const showSource = kind === "text" || (kind === "markdown" && markdownMode === "source");

  useEffect(() => {
    if (line && kind === "markdown" && markdownMode !== "source") setMarkdownMode(path, "source");
  }, [line, kind, markdownMode, path, setMarkdownMode]);

  const clearLine = useCallback(() => void useViewerStore.getState().takeLine(path), [path]);

  const save = useCallback(() => {
    const base = contentRef.current;
    if (base) void saveFile(path, base, reload);
  }, [path, reload]);

  const textRef = useRef(text);
  textRef.current = text;
  const handleChange = useCallback(
    (value: string) => setDraft(path, value === textRef.current ? null : value),
    [path, setDraft],
  );

  const workspaceId = workspace.id;
  const onOpenPath = useCallback(
    (target: string) => openPathInWorkspace(workspaceId, target),
    [workspaceId],
  );

  const body = () => {
    if (!needsText) return <MediaFile path={path} kind={kind} />;
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
      <CodeView
        path={path}
        value={draft ?? text}
        editable={editing && !readOnly}
        line={line}
        onLineShown={clearLine}
        onChange={handleChange}
        onSave={save}
      />
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
        onSave={save}
        onReload={() => void reloadWithConfirm(path, dirty, reload)}
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
              <Button size="sm" variant="ghost" onClick={() => void discardAndReload(path, reload)}>
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

type TabBoundaryProps = {
  workspace: Workspace;
  tab: string;
  children: React.ReactNode;
};

const TabBoundary = ({ workspace, tab, children }: TabBoundaryProps) => (
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
            <Button size="sm" onClick={() => void closeFilesWithConfirm(workspace.id, [tab])}>
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

type FileBodyProps = {
  workspace: Workspace;
  tab: string;
};

const FileBody = ({ workspace, tab }: FileBodyProps) => {
  const diff = useMemo(() => decodeDiffTab(tab), [tab]);
  if (diff) return <DiffView tab={diff} workspace={workspace} />;
  return <DocumentBody workspace={workspace} path={tab} />;
};

type FileViewerProps = {
  workspace: Workspace;
};

export const FileViewer = ({ workspace }: FileViewerProps) => {
  const activeFile = workspace.activeFile ?? workspace.openFiles[0];
  const serverTabs = workspace.openFiles.flatMap((tab) => {
    const serverId = decodeMcpTab(tab);
    return serverId === null ? [] : [{ tab, serverId }];
  });
  const activeIsServer = !!activeFile && decodeMcpTab(activeFile) !== null;

  useEffect(() => {
    if (!workspace.activeFile && activeFile)
      useWorkspaceStore.getState().setActiveFile(workspace.id, activeFile);
  }, [workspace.id, workspace.activeFile, activeFile]);

  if (!activeFile) return null;
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <FileTabs workspace={workspace} />
      {serverTabs.map(({ tab, serverId }) => (
        <div
          key={tab}
          className={samePath(tab, activeFile) ? "flex min-h-0 flex-1 flex-col" : "hidden"}
        >
          <TabBoundary workspace={workspace} tab={tab}>
            <McpView workspace={workspace} serverId={serverId} />
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
