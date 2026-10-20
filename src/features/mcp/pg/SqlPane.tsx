import { useCallback, useMemo, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ErrorAlert } from "@/components/ui/error-alert";
import { Spinner } from "@/components/ui/feedback";
import { Kbd } from "@/components/ui/kbd";
import { ResultGrid } from "@/features/mcp/ResultGrid";
import { CodeView } from "@/features/viewer/CodeView";
import { isMutating } from "@/lib/sql";
import { errorMessage, failedTo, plural } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import type { PgRunner } from "@/lib/mcp/pg-queries";
import type { PgOutput } from "@/types";

const DEFAULT_SQL = "select now();";
const SQL_DRAFT_KEY_PREFIX = "agent-deck:sql:";
const draftKey = (serverId: string) => `${SQL_DRAFT_KEY_PREFIX}${serverId}`;

const useSqlDraft = (serverId: string) => {
  const [sql, setSql] = useState(() => localStorage.getItem(draftKey(serverId)) ?? DEFAULT_SQL);
  const update = useCallback(
    (value: string) => {
      setSql(value);
      try {
        localStorage.setItem(draftKey(serverId), value);
      } catch (error) {
        toast.error(failedTo("save the SQL draft", error), {
          id: draftKey(serverId),
        });
      }
    },
    [serverId],
  );
  return [sql, update] as const;
};

const confirmMutation = () =>
  useUiStore.getState().askConfirm({
    title: "Run a statement that changes the database?",
    description:
      "This SQL can modify data or schema. It runs directly against the server's database.",
    confirmLabel: "Run it",
    destructive: true,
  });

type SqlPaneProps = PgRunner & {
  serverId: string;
};

export const SqlPane = ({ serverId, run, cancel }: SqlPaneProps) => {
  const [sql, setSql] = useSqlDraft(serverId);
  const [output, setOutput] = useState<PgOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);
  const sqlRef = useRef(sql);
  sqlRef.current = sql;

  const execute = useCallback(async () => {
    const text = sqlRef.current.trim();
    if (!text || runningRef.current) return;
    runningRef.current = true;
    try {
      if (isMutating(text) && !(await confirmMutation())) return;
      setRunning(true);
      setOutput(await run(text));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }, [run]);

  const grids = useMemo(
    () =>
      output?.results.map((result, index) =>
        result.columns.length ? (
          <ResultGrid
            key={index}
            className="mb-3 max-h-[480px]"
            columns={result.columns}
            rows={result.rows}
            footer={
              result.truncated ? <span>showing the first {result.rows.length}</span> : undefined
            }
          />
        ) : (
          <p key={index} className="mb-2 text-[12px] text-muted">
            Done · {plural(result.rowCount, "row")} affected
          </p>
        ),
      ),
    [output],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="h-[34%] min-h-[120px] shrink-0 overflow-hidden border-b border-border bg-code-bg">
        <CodeView
          path="query.sql"
          value={sql}
          editable
          onChange={setSql}
          onSave={() => void execute()}
        />
      </div>
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <Button size="sm" variant="primary" disabled={running} onClick={() => void execute()}>
          <Play className="fill-current" /> Run
        </Button>
        <span className="flex items-center gap-1 text-[11px] text-faint">
          <Kbd keys="Ctrl S" /> runs the query
        </span>
        {running && (
          <>
            <Spinner className="size-3.5" />
            <Button size="xs" variant="ghost" onClick={cancel}>
              <Square /> Stop
            </Button>
          </>
        )}
        {output && !running && (
          <span className="ml-auto text-[11px] text-faint tabular-nums">{output.elapsedMs} ms</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {error && <ErrorAlert message={error} className="mb-2" />}
        {grids}
      </div>
    </div>
  );
};
