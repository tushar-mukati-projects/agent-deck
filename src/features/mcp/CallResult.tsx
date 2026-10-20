import { memo, useMemo } from "react";

import { Alert } from "@/components/ui/alert";
import { ResultGrid } from "@/features/mcp/ResultGrid";
import {
  callResultParts,
  gridFromObjects,
  JSON_INDENT,
  parseJson,
  type ContentItem,
} from "@/lib/mcp/results";

type TextResultProps = {
  text: string;
};

export const TextResult = memo(({ text }: TextResultProps) => {
  const { parsed, grid } = useMemo(() => {
    const value = parseJson(text);
    return { parsed: value, grid: value !== undefined ? gridFromObjects(value) : null };
  }, [text]);
  if (grid) return <ResultGrid className="max-h-[520px]" columns={grid.columns} rows={grid.rows} />;
  return (
    <pre className="max-h-[520px] overflow-auto rounded-md border border-border bg-code-bg p-3 font-mono text-[11.5px] break-words whitespace-pre-wrap text-fg/90 select-text">
      {parsed !== undefined ? JSON.stringify(parsed, null, JSON_INDENT) : text}
    </pre>
  );
});
TextResult.displayName = "TextResult";

type ContentViewProps = {
  item: ContentItem;
};

const ContentView = ({ item }: ContentViewProps) => {
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
  return <TextResult text={JSON.stringify(item, null, JSON_INDENT)} />;
};

type CallResultProps = {
  result: unknown;
};

export const CallResult = memo(({ result }: CallResultProps) => {
  const { content, isError, structured } = callResultParts(result);
  return (
    <div className="flex flex-col gap-2">
      {isError && <Alert tone="danger">The tool reported an error.</Alert>}
      {content.length === 0 && <TextResult text={JSON.stringify(structured ?? result ?? null)} />}
      {content.map((item, index) => (
        <ContentView key={index} item={item} />
      ))}
    </div>
  );
});
CallResult.displayName = "CallResult";
