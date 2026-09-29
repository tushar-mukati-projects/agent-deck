import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { createTheme } from "@uiw/codemirror-themes";
import CodeMirror from "@uiw/react-codemirror";

import { findTheme } from "@/lib/themes";
import { basename, normalizePath } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";

const makeTheme = (kind: "dark" | "light") =>
  createTheme({
    theme: kind,
    settings: {
      background: "var(--color-code-bg)",
      foreground: "var(--color-fg)",
      caret: "var(--color-accent)",
      selection: "var(--color-selection)",
      selectionMatch: "color-mix(in srgb, var(--color-accent) 14%, transparent)",
      lineHighlight: "color-mix(in srgb, var(--color-fg) 4%, transparent)",
      gutterBackground: "var(--color-code-bg)",
      gutterForeground: "var(--color-faint)",
      gutterActiveForeground: "var(--color-muted)",
      gutterBorder: "transparent",
    },
    styles: [
      {
        tag: [t.comment, t.lineComment, t.blockComment],
        color: "var(--syntax-comment)",
        fontStyle: "italic",
      },
      {
        tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword],
        color: "var(--syntax-keyword)",
      },
      { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syntax-string)" },
      { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syntax-number)" },
      {
        tag: [t.function(t.variableName), t.function(t.propertyName)],
        color: "var(--syntax-function)",
      },
      { tag: [t.typeName, t.className, t.namespace], color: "var(--syntax-type)" },
      { tag: [t.propertyName, t.attributeName], color: "var(--syntax-property)" },
      { tag: [t.tagName, t.angleBracket], color: "var(--syntax-tag)" },
      { tag: [t.variableName, t.definition(t.variableName)], color: "var(--syntax-variable)" },
      { tag: [t.operator, t.punctuation, t.separator], color: "var(--syntax-operator)" },
      { tag: [t.heading], color: "var(--syntax-heading)", fontWeight: "600" },
      { tag: [t.link, t.url], color: "var(--syntax-link)", textDecoration: "underline" },
      { tag: [t.emphasis], fontStyle: "italic" },
      { tag: [t.strong], fontWeight: "600" },
      { tag: [t.meta, t.annotation], color: "var(--syntax-type)" },
      { tag: [t.invalid], color: "var(--color-danger)" },
    ],
  });

const THEMES = { dark: makeTheme("dark"), light: makeTheme("light") };

export const useDeckTheme = () => THEMES[findTheme(useSettingsStore((s) => s.themeId)).kind];

export const useLanguage = (path: string) => {
  const description = useMemo(
    () => LanguageDescription.matchFilename(languages, basename(path)),
    [path],
  );
  const [loaded, setLoaded] = useState<{ path: string; support: Extension } | null>(null);
  useEffect(() => {
    if (!description || description.support) return;
    let cancelled = false;
    description
      .load()
      .then((support) => !cancelled && setLoaded({ path, support }))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [description, path]);
  return description?.support ?? (loaded?.path === path ? loaded.support : null);
};

const EDIT_SETUP = {
  foldGutter: true,
  highlightActiveLine: true,
  highlightActiveLineGutter: true,
  autocompletion: false,
  searchKeymap: true,
};
const VIEW_SETUP = { ...EDIT_SETUP, highlightActiveLine: false, highlightActiveLineGutter: false };

const scrollPositions = new Map<string, number>();

interface CodeViewProps {
  path: string;
  value: string;
  editable: boolean;
  line?: number | null;
  onLineShown?: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
}

export const CodeView = ({
  path,
  value,
  editable,
  line,
  onLineShown,
  onChange,
  onSave,
}: CodeViewProps) => {
  const language = useLanguage(path);
  const theme = useDeckTheme();
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const viewRef = useRef<EditorView | null>(null);
  const key = normalizePath(path);

  const extensions = useMemo(
    () => [
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (saveRef.current(), true) }]),
      ...(language ? [language] : []),
    ],
    [language],
  );
  const handleChange = useCallback((next: string) => changeRef.current(next), []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !line) return;
    const target = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
    view.dispatch({
      selection: { anchor: target.from },
      effects: EditorView.scrollIntoView(target.from, { y: "center" }),
    });
    view.focus();
    onLineShown?.();
  }, [line, onLineShown]);

  useEffect(
    () => () => {
      const scroller = viewRef.current?.scrollDOM;
      if (scroller) scrollPositions.set(key, scroller.scrollTop);
    },
    [key],
  );

  return (
    <CodeMirror
      value={value}
      height="100%"
      className="h-full"
      theme={theme}
      editable={editable}
      readOnly={!editable}
      extensions={extensions}
      onChange={handleChange}
      basicSetup={editable ? EDIT_SETUP : VIEW_SETUP}
      onCreateEditor={(view) => {
        viewRef.current = view;
        const saved = scrollPositions.get(key);
        if (saved && !line) requestAnimationFrame(() => (view.scrollDOM.scrollTop = saved));
      }}
    />
  );
};
