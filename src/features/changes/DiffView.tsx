import { useEffect, useMemo, useState } from "react";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { FileCode2, FolderOpen } from "lucide-react";

import { EmptyState, Spinner } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { useDeckTheme, useLanguage } from "@/features/viewer/CodeView";
import type { DiffTab } from "@/lib/diff-tabs";
import { api } from "@/lib/tauri/commands";
import { revealInExplorer } from "@/lib/tauri/system";
import { basename, errorMessage, relativePath } from "@/lib/utils";
import { useSessionsStore } from "@/stores/sessions-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

interface DiffContent {
  before: string;
  after: string;
  beforeLabel: string;
}

const readCurrent = async (path: string) => {
  const content = await api.readFile(path).catch(() => null);
  return content?.kind === "text" ? content.text : "";
};

const loadDiff = async (tab: DiffTab, sessionId: string): Promise<DiffContent> => {
  const after = await readCurrent(tab.path);
  if (tab.source === "git") {
    const before = await api.gitHeadFile(tab.path).catch(() => "");
    return { before, after, beforeLabel: "HEAD" };
  }
  const session = useSessionsStore.getState().byId[sessionId];
  const before =
    tab.backup && session
      ? await api.sessionBackup(session.filePath, tab.backup, session.distro)
      : "";
  return { before, after, beforeLabel: "before this session" };
};

const diffTheme = EditorView.theme({
  ".cm-changedLine": {
    backgroundColor: "color-mix(in srgb, var(--color-add) 7%, transparent) !important",
  },
  ".cm-changedText": {
    background: "color-mix(in srgb, var(--color-add) 13%, transparent) !important",
  },
  ".cm-deletedChunk": { backgroundColor: "color-mix(in srgb, var(--color-del) 7%, transparent)" },
  ".cm-deletedChunk .cm-deletedText": {
    background: "color-mix(in srgb, var(--color-del) 15%, transparent)",
  },
  ".cm-insertedLine, .cm-changedLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--color-add) 45%, transparent)",
  },
  ".cm-deletedLineGutter": {
    backgroundColor: "color-mix(in srgb, var(--color-del) 50%, transparent)",
  },
  ".cm-collapsedLines": {
    background: "var(--color-panel)",
    color: "var(--color-faint)",
    fontSize: "11px",
    padding: "3px 10px",
    borderTop: "1px solid var(--color-border)",
    borderBottom: "1px solid var(--color-border)",
  },
});

export const DiffView = ({ tab, workspace }: { tab: DiffTab; workspace: Workspace }) => {
  const [content, setContent] = useState<DiffContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const language = useLanguage(tab.path);
  const theme = useDeckTheme();
  const openFile = useWorkspaceStore((s) => s.openFile);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    loadDiff(tab, workspace.sessionId)
      .then((result) => !cancelled && setContent(result))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [tab.source, tab.path, tab.backup, workspace.sessionId]);

  const extensions = useMemo(
    () =>
      content
        ? [
            EditorView.lineWrapping,
            diffTheme,
            unifiedMergeView({
              original: content.before,
              mergeControls: false,
              highlightChanges: true,
              gutter: true,
              syntaxHighlightDeletions: true,
              collapseUnchanged: { margin: 3, minSize: 6 },
            }),
            ...(language ? [language] : []),
          ]
        : [],
    [content, language],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted" title={tab.path}>
          {relativePath(tab.path, workspace.cwd)}
          {content && <span className="ml-2 text-faint">vs {content.beforeLabel}</span>}
        </span>
        <IconButton label="Open file" onClick={() => openFile(workspace.id, tab.path)}>
          <FileCode2 />
        </IconButton>
        <IconButton label="Reveal in File Explorer" onClick={() => void revealInExplorer(tab.path)}>
          <FolderOpen />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-code-bg">
        {error ? (
          <EmptyState
            className="h-full"
            icon={<FileCode2 />}
            title={`Couldn't diff ${basename(tab.path)}`}
            description={error}
          />
        ) : !content ? (
          <div className="flex h-full items-center justify-center">
            <Spinner />
          </div>
        ) : content.before === content.after ? (
          <EmptyState
            className="h-full"
            icon={<FileCode2 />}
            title="No differences"
            description="The file matches its earlier version."
          />
        ) : (
          <CodeMirror
            value={content.after}
            height="100%"
            className="h-full"
            theme={theme}
            editable={false}
            readOnly
            extensions={extensions}
            basicSetup={{
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
            }}
          />
        )}
      </div>
    </div>
  );
};
