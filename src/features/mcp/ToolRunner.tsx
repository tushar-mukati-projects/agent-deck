import { useCallback, useRef, useState } from "react";
import { Play, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
import { Spinner } from "@/components/ui/feedback";
import { Kbd } from "@/components/ui/kbd";
import { Tag } from "@/components/ui/tag";
import { CallResult } from "@/features/mcp/CallResult";
import { CodeView } from "@/features/viewer/CodeView";
import { MarkdownView } from "@/features/viewer/MarkdownView";
import { confirmReason, exampleArguments } from "@/lib/mcp/schema";
import { api } from "@/lib/tauri/commands";
import { errorMessage } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import type { JsonSchema, McpTool } from "@/types";

const typeLabel = (schema: JsonSchema) =>
  Array.isArray(schema.type) ? schema.type.join(" | ") : (schema.type ?? "any");

type ParametersProps = {
  schema?: JsonSchema;
};

const Parameters = ({ schema }: ParametersProps) => {
  const properties = Object.entries(schema?.properties ?? {});
  if (!properties.length)
    return <p className="text-[11.5px] text-faint">This tool takes no arguments.</p>;
  const required = new Set(schema?.required ?? []);
  return (
    <div className="flex flex-col gap-1">
      {properties.map(([name, prop]) => (
        <div key={name} className="text-[11.5px] break-words">
          <span className="font-mono text-fg/90">{name}</span>
          <span className="ml-1.5 font-mono text-faint">
            {typeLabel(prop)}
            {required.has(name) ? "" : "?"}
          </span>
          {prop.enum && (
            <span className="ml-1.5 text-faint">one of {prop.enum.map(String).join(", ")}</span>
          )}
          {prop.description && <p className="text-faint">{prop.description}</p>}
        </div>
      ))}
    </div>
  );
};

type Outcome =
  | { kind: "result"; result: unknown; elapsedMs: number }
  | { kind: "error"; error: string; elapsedMs: number };

type ToolRunnerProps = {
  cwd: string;
  serverId: string;
  tool: McpTool;
};

export const ToolRunner = ({ cwd, serverId, tool }: ToolRunnerProps) => {
  const [args, setArgs] = useState(() => exampleArguments(tool.inputSchema));
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const argsRef = useRef(args);
  argsRef.current = args;

  const run = useCallback(async () => {
    if (runningRef.current) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsRef.current || "{}");
      setParseError(null);
    } catch (e) {
      setParseError(`Arguments aren't valid JSON: ${errorMessage(e)}`);
      return;
    }
    runningRef.current = true;
    try {
      const reason = confirmReason(tool, parsed);
      if (reason) {
        const ok = await useUiStore.getState().askConfirm({
          title: `Run ${tool.name}?`,
          description: `${reason} It may change or delete data.`,
          confirmLabel: "Run tool",
          destructive: true,
        });
        if (!ok) return;
      }
      setRunning(true);
      const started = performance.now();
      const elapsed = () => Math.round(performance.now() - started);
      try {
        const result = await api.mcpCall(cwd, serverId, tool.name, parsed);
        setOutcome({ kind: "result", result, elapsedMs: elapsed() });
      } catch (e) {
        setOutcome({ kind: "error", error: errorMessage(e), elapsedMs: elapsed() });
      }
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [cwd, serverId, tool]);

  const error = parseError ?? (outcome?.kind === "error" ? outcome.error : null);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      <div className="flex min-w-0 items-center gap-2">
        <Wrench className="size-4 shrink-0 text-faint" />
        <h2
          className="min-w-0 truncate font-mono text-[13.5px] font-semibold text-fg"
          title={tool.name}
        >
          {tool.name}
        </h2>
        {tool.annotations?.readOnlyHint && <Tag>read-only</Tag>}
        {tool.annotations?.destructiveHint && <Tag>destructive</Tag>}
      </div>
      {tool.description && (
        <div className="mt-2 max-h-[200px] overflow-y-auto">
          <MarkdownView source={tool.description} compact />
        </div>
      )}
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
        <div className="h-[180px] overflow-hidden rounded-md border border-border bg-code-bg">
          <CodeView
            path="arguments.json"
            value={args}
            editable
            onChange={setArgs}
            onSave={() => void run()}
          />
        </div>
        <div className="max-h-[180px] overflow-y-auto">
          <Parameters schema={tool.inputSchema} />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" variant="primary" disabled={running} onClick={() => void run()}>
          <Play className="fill-current" /> Run tool
        </Button>
        <span className="flex items-center gap-1 text-[11px] text-faint">
          <Kbd keys="Ctrl S" /> in the editor also runs it
        </span>
        {running && <Spinner className="size-3.5" />}
        {outcome && !running && (
          <span className="ml-auto text-[11px] text-faint tabular-nums">
            {outcome.elapsedMs} ms
          </span>
        )}
      </div>
      <div className="mt-3">
        {error && <ErrorAlert message={error} />}
        {outcome?.kind === "result" && <CallResult result={outcome.result} />}
      </div>
    </div>
  );
};
