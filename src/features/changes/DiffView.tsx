import { useEffect, useMemo } from "react";
import { unifiedMergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import CodeMirror from "@uiw/react-codemirror";
import { FileCode2, FolderOpen } from "lucide-react";

import { EmptyState, LoadingState } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { useDeckTheme, useLanguage } from "@/features/viewer/CodeView";
import { useAsync, useThrottledCallback } from "@/hooks/useAsync";
import { useSessionFile } from "@/hooks/useSessionFile";
import { gitChangeStatus } from "@/lib/changes";
import type { DiffTab } from "@/lib/diff-tabs";
import { subscribeFileChanges } from "@/lib/file-events";
import { api } from "@/lib/tauri/commands";
import { revealInExplorer } from "@/lib/tauri/system";
import { basename, dirname, normalizePath, relativePath, samePath } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { Workspace } from "@/types";

const RELOAD_DELAY_MS = 300;
const RELOAD_MAX_WAIT_MS = 2000;
const UNCHANGED_MARGIN_LINES = 3;
const UNCHANGED_MIN_LINES = 6;

interface DiffContent {
  before: string;
  after: string;
  beforeLabel: string;
}

const readCurrent = async (path: string) => {
  const content = await api.readFile(path).catch(async (error: unknown) => {
    if (await api.statPath(path)) throw error;
    return null;
  });
  return content?.kind === "text" ? content.text : "";
};

const readHead = async (path: string) => {
  try {
    return await api.gitHeadFile(path);
  } catch (error) {
    const changes = await api.gitStatus(dirname(path));
    if (changes.some((c) => samePath(c.path, path) && gitChangeStatus(c.code) === "added"))
      return "";
    throw error;
  }
};

const loadDiff = async (
  tab: DiffTab,
  session: ReturnType<typeof useSessionFile>,
): Promise<DiffContent> => {
  const after = await readCurrent(tab.path);
  if (tab.source === "git") {
    return { before: await readHead(tab.path), after, beforeLabel: "HEAD" };
  }
  const before =
    tab.backup && session.filePath
      ? await api.sessionBackup(session.filePath, tab.backup, session.distro)
      : "";
  return { before, after, beforeLabel: "before this session" };
};

const VIEW_SETUP = {
  foldGutter: false,
  highlightActiveLine: false,
  highlightActiveLineGutter: false,
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

type DiffViewProps = {
  tab: DiffTab;
  workspace: Workspace;
};

export const DiffView = ({ tab, workspace }: DiffViewProps) => {
  const session = useSessionFile(workspace);
  const language = useLanguage(tab.path);
  const theme = useDeckTheme();
  const openFile = useWorkspaceStore((s) => s.openFile);
  const {
    data: content,
    error,
    reload,
  } = useAsync(
    () => loadDiff(tab, session),
    [tab.source, tab.path, tab.backup, session.filePath, session.distro],
    { keepPrevious: true },
  );

  const scheduleReload = useThrottledCallback(
    () => void reload(true),
    RELOAD_DELAY_MS,
    RELOAD_MAX_WAIT_MS,
  );

  useEffect(() => {
    const target = normalizePath(tab.path);
    return subscribeFileChanges((change) => {
      if (change.paths.some((p) => normalizePath(p) === target)) scheduleReload();
    });
  }, [tab.path, scheduleReload]);

  const before = content?.before;
  const extensions = useMemo(
    () =>
      before !== undefined
        ? [
            EditorView.lineWrapping,
            diffTheme,
            unifiedMergeView({
              original: before,
              mergeControls: false,
              highlightChanges: true,
              gutter: true,
              syntaxHighlightDeletions: true,
              collapseUnchanged: { margin: UNCHANGED_MARGIN_LINES, minSize: UNCHANGED_MIN_LINES },
            }),
            ...(language ? [language] : []),
          ]
        : [],
    [before, language],
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
        {error && !content ? (
          <EmptyState
            className="h-full"
            icon={<FileCode2 />}
            title={`Couldn't diff ${basename(tab.path)}`}
            description={error}
          />
        ) : !content ? (
          <LoadingState className="h-full" />
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
            basicSetup={VIEW_SETUP}
          />
        )}
      </div>
    </div>
  );
};
