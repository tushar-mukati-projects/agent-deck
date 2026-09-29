import { memo, useMemo } from "react";

import { Alert } from "@/components/ui/panel";
import { gridFromObjects, ResultGrid } from "@/features/mcp/ResultGrid";

interface ContentItem {
  type?: string;
  text?: string;
  data?: string;
  mimeType?: string;
  resource?: { uri?: string; text?: string };
}

const parseJson = (text: string) => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

export const TextResult = memo(({ text }: { text: string }) => {
  const { parsed, grid } = useMemo(() => {
    const value = parseJson(text);
    return { parsed: value, grid: value !== undefined ? gridFromObjects(value) : null };
  }, [text]);
  if (grid) return <ResultGrid className="max-h-[520px]" columns={grid.columns} rows={grid.rows} />;
  return (
    <pre className="max-h-[520px] overflow-auto rounded-md border border-border bg-code-bg p-3 font-mono text-[11.5px] break-words whitespace-pre-wrap text-fg/90 select-text">
      {parsed !== undefined ? JSON.stringify(parsed, null, 2) : text}
    </pre>
  );
});
TextResult.displayName = "TextResult";

const asItems = (value: unknown): ContentItem[] =>
  Array.isArray(value) ? value.filter((v): v is ContentItem => !!v && typeof v === "object") : [];

const ContentView = ({ item }: { item: ContentItem }) => {
  if (item.type === "text" && typeof item.text === "string") return <TextResult text={item.text} />;
  if (item.type === "image" && typeof item.data === "string")
    return (
      <img
        alt=""
        src={`data:${item.mimeType ?? "image/png"};base64,${item.data}`}
        className="max-h-[480px] max-w-full self-start rounded-md border border-border"
      />
    );
  if (item.type === "resource" && typeof item.resource?.text === "string")
    return <TextResult text={item.resource.text} />;
  return <TextResult text={JSON.stringify(item, null, 2)} />;
};

export const CallResult = ({ result }: { result: unknown }) => {
  const value = (result && typeof result === "object" ? result : {}) as {
    content?: unknown;
    isError?: boolean;
    structuredContent?: unknown;
  };
  const content = asItems(value.content);
  return (
    <div className="flex flex-col gap-2">
      {value.isError && <Alert tone="danger">The tool reported an error.</Alert>}
      {content.length === 0 && (
        <TextResult text={JSON.stringify(value.structuredContent ?? result ?? null)} />
      )}
      {content.map((item, index) => (
        <ContentView key={index} item={item} />
      ))}
    </div>
  );
};

export const resourceTexts = (value: unknown) => {
  const contents = (value && typeof value === "object" ? value : {}) as { contents?: unknown };
  return asItems(contents.contents).map((c) =>
    typeof c.text === "string" ? c.text : JSON.stringify(c, null, 2),
  );
};
