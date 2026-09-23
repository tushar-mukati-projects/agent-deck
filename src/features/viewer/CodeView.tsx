import { useEffect, useMemo, useState } from "react";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { createTheme } from "@uiw/codemirror-themes";
import CodeMirror from "@uiw/react-codemirror";

import { basename } from "@/lib/utils";

export const deckTheme = createTheme({
  theme: "dark",
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
    { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--syntax-comment)", fontStyle: "italic" },
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: "var(--syntax-keyword)" },
    { tag: [t.string, t.special(t.string), t.regexp], color: "var(--syntax-string)" },
    { tag: [t.number, t.bool, t.null, t.atom], color: "var(--syntax-number)" },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "var(--syntax-function)" },
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

export const useLanguage = (path: string) => {
  const [extension, setExtension] = useState<Extension | null>(null);
  useEffect(() => {
    let cancelled = false;
    setExtension(null);
    const description = LanguageDescription.matchFilename(languages, basename(path));
    description
      ?.load()
      .then((support) => !cancelled && setExtension(support))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path]);
  return extension;
};

interface CodeViewProps {
  path: string;
  value: string;
  editable: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

export const CodeView = ({ path, value, editable, onChange, onSave }: CodeViewProps) => {
  const language = useLanguage(path);

  const extensions = useMemo(
    () => [
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (onSave(), true) }]),
      ...(language ? [language] : []),
    ],
    [language, onSave],
  );

  return (
    <CodeMirror
      value={value}
      height="100%"
      className="h-full"
      theme={deckTheme}
      editable={editable}
      readOnly={!editable}
      extensions={extensions}
      onChange={onChange}
      basicSetup={{
        foldGutter: true,
        highlightActiveLine: editable,
        highlightActiveLineGutter: editable,
        autocompletion: false,
        searchKeymap: true,
      }}
    />
  );
};
