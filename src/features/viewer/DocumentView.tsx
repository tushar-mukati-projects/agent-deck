import { useCallback, useEffect, useRef } from "react";
import { ExternalLink, FileQuestion } from "lucide-react";

import { discardAndReload, openPathInWorkspace, reloadWithConfirm } from "@/actions/files";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState, showError } from "@/components/ui/feedback";
import { CodeView } from "@/features/viewer/CodeView";
import { FileToolbar } from "@/features/viewer/FileToolbar";
import { MarkdownView } from "@/features/viewer/MarkdownView";
import { MediaView } from "@/features/viewer/MediaView";
import { useDocumentSave } from "@/features/viewer/useDocumentSave";
import { useFileContent } from "@/features/viewer/useFileContent";
import { openExternal } from "@/lib/tauri/system";
import { basename, dirname, normalizePath } from "@/lib/utils";
import { isTextKind, viewKind } from "@/lib/view-kind";
import { useViewerStore } from "@/stores/viewer-store";
import type { Workspace } from "@/types";

type DocumentViewProps = {
  workspace: Workspace;
  path: string;
};

export const DocumentView = ({ workspace, path }: DocumentViewProps) => {
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
  const text = content?.text ?? null;
  const readOnly = content?.encoding === "lossy";
  const showSource = kind === "text" || (kind === "markdown" && markdownMode === "source");

  useEffect(() => {
    if (line && kind === "markdown" && markdownMode !== "source") setMarkdownMode(path, "source");
  }, [line, kind, markdownMode, path, setMarkdownMode]);

  const clearLine = useCallback(() => void useViewerStore.getState().takeLine(path), [path]);

  const save = useDocumentSave(path, content, reload);

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
    if (!needsText) return <MediaView path={path} kind={kind} />;
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
        line={line ?? undefined}
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
