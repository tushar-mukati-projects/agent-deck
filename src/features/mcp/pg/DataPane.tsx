import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/panel";
import { ResultGrid } from "@/features/mcp/ResultGrid";
import { buildSelect, PAGE_SIZE, type Order, type TableRef } from "@/features/mcp/pg/queries";
import { isMutating } from "@/lib/sql";
import { errorMessage, plural } from "@/lib/utils";
import type { PgOutput, PgResult } from "@/types";

const orderValue = (order: Order | null) =>
  order ? `${order.column}:${order.desc ? "desc" : "asc"}` : "";

const parseOrder = (value: string): Order | null => {
  const [column, dir] = value.split(/:(?=asc$|desc$)/);
  return column ? { column, desc: dir === "desc" } : null;
};

export const DataPane = ({
  table,
  run,
  cancel,
}: {
  table: TableRef;
  run: (sql: string) => Promise<PgOutput>;
  cancel: () => void;
}) => {
  const [page, setPage] = useState(0);
  const [order, setOrder] = useState<Order | null>(null);
  const [where, setWhere] = useState("");
  const [appliedWhere, setAppliedWhere] = useState("");
  const [result, setResult] = useState<PgResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const request = ++requestRef.current;
    const sql = buildSelect(table, { where: appliedWhere, order, page });
    if (isMutating(sql)) {
      setResult(null);
      setError("The filter must be a single condition, not another statement.");
      setLoading(false);
      return;
    }
    setLoading(true);
    run(sql)
      .then((out) => {
        if (request !== requestRef.current) return;
        setResult(out.results.at(-1) ?? null);
        setError(null);
      })
      .catch((e) => {
        if (request !== requestRef.current) return;
        setResult(null);
        setError(errorMessage(e));
      })
      .finally(() => request === requestRef.current && setLoading(false));
  }, [table, page, order, appliedWhere, run]);

  const hasMore = (result?.rows.length ?? 0) > PAGE_SIZE;
  const rows = useMemo(() => result?.rows.slice(0, PAGE_SIZE) ?? [], [result]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(0);
          setAppliedWhere(where);
        }}
      >
        <span className="font-mono text-[11.5px] text-faint">where</span>
        <Input
          aria-label="Filter rows"
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          placeholder="e.g. created_at > now() - interval '1 day'"
          className="h-7 min-w-0 flex-1 px-2 font-mono text-[11.5px]"
        />
        <Button size="sm" type="submit">
          Apply
        </Button>
        {result && (
          <select
            aria-label="Sort rows"
            value={orderValue(order)}
            onChange={(e) => {
              setPage(0);
              setOrder(parseOrder(e.target.value));
            }}
            className="h-7 max-w-[200px] rounded-md border border-border bg-bg px-1.5 text-[11.5px] text-fg outline-none"
          >
            <option value="">No sorting</option>
            {result.columns.flatMap((c) => [
              <option key={`${c}:asc`} value={`${c}:asc`}>
                {c} ↑
              </option>,
              <option key={`${c}:desc`} value={`${c}:desc`}>
                {c} ↓
              </option>,
            ])}
          </select>
        )}
        {loading && (
          <>
            <Spinner className="size-3.5" />
            <Button size="xs" variant="ghost" onClick={cancel}>
              <Square /> Stop
            </Button>
          </>
        )}
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
      {result && (
        <ResultGrid
          className="flex-1"
          columns={result.columns}
          rows={rows}
          rowsLabel={`${plural(rows.length, "row")} on this page`}
          footer={
            <span className="flex items-center gap-1">
              <Button
                size="xs"
                variant="ghost"
                disabled={page === 0 || loading}
                onClick={() => setPage((p) => p - 1)}
              >
                <ArrowUp /> Prev
              </Button>
              <span className="tabular-nums">page {page + 1}</span>
              <Button
                size="xs"
                variant="ghost"
                disabled={!hasMore || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                <ArrowDown /> Next
              </Button>
            </span>
          }
        />
      )}
    </div>
  );
};
