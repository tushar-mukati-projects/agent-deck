import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Database, Eye, Play, RefreshCw, Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { Alert, Chevron, SearchInput, Segmented } from "@/components/ui/panel";
import { ResultGrid } from "@/features/mcp/ResultGrid";
import { isMutating, quoteIdent, quoteLiteral } from "@/lib/sql";
import { api } from "@/lib/tauri/commands";
import { cn, errorMessage } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import type { PgInfo, PgOutput, PgResult } from "@/types";

const CodeView = lazy(() =>
  import("@/features/viewer/CodeView").then((m) => ({ default: m.CodeView })),
);

const PAGE_SIZE = 100;

const TABLES_SQL = `select n.nspname, c.relname,
  case c.relkind when 'v' then 'view' when 'm' then 'matview' when 'f' then 'foreign' else 'table' end,
  greatest(c.reltuples, 0)::bigint
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'v', 'm', 'f')
  and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
order by 1, 2`;

interface TableRef {
  schema: string;
  name: string;
  kind: string;
  estimate: number;
}

type Pane = "data" | "structure" | "sql";

const sqlKey = (serverId: string) => `claude-deck:sql:${serverId}`;

const loadSql = (serverId: string) => {
  try {
    return localStorage.getItem(sqlKey(serverId)) ?? "select now();";
  } catch {
    return "select now();";
  }
};

const saveSql = (serverId: string, sql: string) => {
  try {
    localStorage.setItem(sqlKey(serverId), sql);
  } catch {}
};

const useQuery = (cwd: string, serverId: string) =>
  useCallback((sql: string) => api.pgQuery(cwd, serverId, sql), [cwd, serverId]);

const qualified = (table: TableRef) => `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`;

const TableList = ({
  tables,
  selected,
  onSelect,
}: {
  tables: TableRef[];
  selected: TableRef | null;
  onSelect: (table: TableRef) => void;
}) => {
  const [filter, setFilter] = useState("");
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const bySchema = new Map<string, TableRef[]>();
    for (const table of tables) {
      if (needle && !`${table.schema}.${table.name}`.toLowerCase().includes(needle)) continue;
      bySchema.set(table.schema, [...(bySchema.get(table.schema) ?? []), table]);
    }
    return [...bySchema.entries()];
  }, [tables, filter]);

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border bg-panel">
      <div className="p-2">
        <SearchInput value={filter} onChange={setFilter} placeholder="Filter tables…" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {groups.length === 0 && <p className="px-2 py-1 text-[11.5px] text-faint">No tables.</p>}
        {groups.map(([schema, list]) => {
          const open = !!filter.trim() || !closed.has(schema);
          return (
            <div key={schema}>
              <button
                type="button"
                onClick={() =>
                  setClosed((c) => {
                    const next = new Set(c);
                    if (next.has(schema)) next.delete(schema);
                    else next.add(schema);
                    return next;
                  })
                }
                className="flex h-6 w-full items-center gap-1.5 px-1.5 text-[11px] font-semibold text-muted hover:text-fg"
              >
                <Chevron open={open} />
                <span className="truncate">{schema}</span>
                <span className="font-normal text-faint">{list.length}</span>
              </button>
              {open &&
                list.map((table) => {
                  const active = selected?.schema === table.schema && selected.name === table.name;
                  return (
                    <button
                      key={table.name}
                      type="button"
                      onClick={() => onSelect(table)}
                      title={`${table.schema}.${table.name}`}
                      className={cn(
                        "flex h-[24px] w-full items-center gap-1.5 rounded pr-2 pl-5 text-left text-[12px]",
                        active ? "bg-active text-fg" : "text-fg/85 hover:bg-hover",
                      )}
                    >
                      {table.kind === "table" ? (
                        <Table2 className="size-3.5 shrink-0 text-faint" />
                      ) : (
                        <Eye className="size-3.5 shrink-0 text-faint" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{table.name}</span>
                      {table.kind === "table" && table.estimate > 0 && (
                        <span className="shrink-0 text-[10px] text-faint tabular-nums">
                          ~{table.estimate.toLocaleString()}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DataPane = ({ table, run }: { table: TableRef; run: (sql: string) => Promise<PgOutput> }) => {
  const [page, setPage] = useState(0);
  const [order, setOrder] = useState<{ column: string; desc: boolean } | null>(null);
  const [where, setWhere] = useState("");
  const [appliedWhere, setAppliedWhere] = useState("");
  const [result, setResult] = useState<PgResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    setPage(0);
    setOrder(null);
    setWhere("");
    setAppliedWhere("");
  }, [table.schema, table.name]);

  useEffect(() => {
    const request = ++requestRef.current;
    const clauses = [
      `select * from ${qualified(table)}`,
      appliedWhere.trim() && `where ${appliedWhere}`,
      order && `order by ${quoteIdent(order.column)} ${order.desc ? "desc" : "asc"}`,
      `limit ${PAGE_SIZE + 1} offset ${page * PAGE_SIZE}`,
    ].filter(Boolean);
    setLoading(true);
    run(clauses.join(" "))
      .then((out) => {
        if (request !== requestRef.current) return;
        setResult(out.results.at(-1) ?? null);
        setError(null);
      })
      .catch((e) => request === requestRef.current && setError(errorMessage(e)))
      .finally(() => request === requestRef.current && setLoading(false));
  }, [table, page, order, appliedWhere, run]);

  const hasMore = (result?.rows.length ?? 0) > PAGE_SIZE;
  const rows = result?.rows.slice(0, PAGE_SIZE) ?? [];

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
        <input
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          placeholder="e.g. created_at > now() - interval '1 day'"
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-bg px-2 font-mono text-[11.5px] text-fg outline-none placeholder:text-faint focus:border-border-strong"
        />
        <Button size="sm" type="submit">
          Apply
        </Button>
        {result && (
          <select
            value={order ? `${order.column}:${order.desc ? "desc" : "asc"}` : ""}
            onChange={(e) => {
              const [column, dir] = e.target.value.split(/:(?=asc$|desc$)/);
              setPage(0);
              setOrder(column ? { column, desc: dir === "desc" } : null);
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
        {loading && <Spinner className="size-3.5" />}
      </form>
      {error && <Alert tone="danger">{error}</Alert>}
      {result && (
        <ResultGrid
          className="flex-1"
          columns={result.columns}
          rows={rows}
          footer={
            <span className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-6"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                <ArrowUp /> Prev
              </Button>
              <span className="tabular-nums">page {page + 1}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6"
                disabled={!hasMore}
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

const STRUCTURE_SQL = (table: TableRef) => `
select column_name as "column", data_type as "type", is_nullable as "nullable", column_default as "default"
from information_schema.columns
where table_schema = ${quoteLiteral(table.schema)} and table_name = ${quoteLiteral(table.name)}
order by ordinal_position;
select indexname as "index", indexdef as "definition" from pg_indexes
where schemaname = ${quoteLiteral(table.schema)} and tablename = ${quoteLiteral(table.name)} order by 1;
select conname as "constraint", pg_get_constraintdef(oid) as "definition" from pg_constraint
where conrelid = ${quoteLiteral(`${quoteIdent(table.schema)}.${quoteIdent(table.name)}`)}::regclass order by 1;`;

const StructurePane = ({
  table,
  run,
}: {
  table: TableRef;
  run: (sql: string) => Promise<PgOutput>;
}) => {
  const [results, setResults] = useState<PgResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setResults(null);
    run(STRUCTURE_SQL(table))
      .then((out) => !cancelled && (setResults(out.results), setError(null)))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [table, run]);

  if (error)
    return (
      <Alert tone="danger" className="m-3">
        {error}
      </Alert>
    );
  if (!results)
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  const titles = ["Columns", "Indexes", "Constraints"];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {results.map((result, index) => (
        <div key={titles[index] ?? index} className="mb-4">
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-muted">
            {titles[index]}
          </p>
          <ResultGrid className="max-h-[360px]" columns={result.columns} rows={result.rows} />
        </div>
      ))}
    </div>
  );
};

const SqlPane = ({
  serverId,
  run,
}: {
  serverId: string;
  run: (sql: string) => Promise<PgOutput>;
}) => {
  const [sql, setSql] = useState(() => loadSql(serverId));
  const [output, setOutput] = useState<PgOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const sqlRef = useRef(sql);
  sqlRef.current = sql;

  const execute = useCallback(async () => {
    const text = sqlRef.current.trim();
    if (!text || running) return;
    if (isMutating(text)) {
      const ok = await useUiStore.getState().askConfirm({
        title: "Run a statement that changes the database?",
        description:
          "This SQL can modify data or schema. It runs directly against the server's database.",
        confirmLabel: "Run it",
        destructive: true,
      });
      if (!ok) return;
    }
    setRunning(true);
    try {
      setOutput(await run(text));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }, [run, running]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="h-[34%] min-h-[120px] shrink-0 overflow-hidden border-b border-border bg-code-bg">
        <Suspense fallback={<Spinner className="m-3" />}>
          <CodeView
            path="query.sql"
            value={sql}
            editable
            onChange={(value) => {
              setSql(value);
              saveSql(serverId, value);
            }}
            onSave={() => void execute()}
          />
        </Suspense>
      </div>
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <Button size="sm" variant="primary" disabled={running} onClick={() => void execute()}>
          <Play className="fill-current" /> Run
        </Button>
        <span className="flex items-center gap-1 text-[11px] text-faint">
          <Kbd keys="Ctrl S" /> runs the query
        </span>
        {running && <Spinner className="size-3.5" />}
        {output && !running && (
          <span className="ml-auto text-[11px] text-faint tabular-nums">{output.elapsedMs} ms</span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {output?.results.map((result, index) =>
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
              Done · {result.rowCount} {result.rowCount === 1 ? "row" : "rows"} affected
            </p>
          ),
        )}
      </div>
    </div>
  );
};

export const PgBrowser = ({ cwd, serverId }: { cwd: string; serverId: string }) => {
  const run = useQuery(cwd, serverId);
  const [info, setInfo] = useState<PgInfo | null>(null);
  const [tables, setTables] = useState<TableRef[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TableRef | null>(null);
  const [pane, setPane] = useState<Pane>("data");

  const loadTables = useCallback(async () => {
    setError(null);
    try {
      const out = await run(TABLES_SQL);
      setTables(
        (out.results[0]?.rows ?? []).map(([schema, name, kind, estimate]) => ({
          schema: schema ?? "",
          name: name ?? "",
          kind: kind ?? "table",
          estimate: Number(estimate ?? 0),
        })),
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [run]);

  useEffect(() => {
    void api
      .pgInfo(cwd, serverId)
      .then(setInfo)
      .catch(() => undefined);
    void loadTables();
  }, [cwd, serverId, loadTables]);

  const connection = info && `${info.user}@${info.host}:${info.port}/${info.database}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Database className="size-3.5 shrink-0 text-info" />
        <span
          className="min-w-0 truncate font-mono text-[11.5px] text-muted"
          title={connection ?? ""}
        >
          {connection ?? "Connecting…"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <Segmented<Pane>
            size="sm"
            value={pane}
            onChange={setPane}
            options={[
              { value: "data", label: "Data" },
              { value: "structure", label: "Structure" },
              { value: "sql", label: "SQL" },
            ]}
          />
          <IconButton label="Reload tables" onClick={() => void loadTables()}>
            <RefreshCw />
          </IconButton>
        </div>
      </div>
      {error ? (
        <div className="p-3">
          <Alert
            tone="danger"
            action={
              <Button size="sm" variant="ghost" onClick={() => void loadTables()}>
                Retry
              </Button>
            }
          >
            <span className="whitespace-pre-wrap">{error}</span>
          </Alert>
        </div>
      ) : !tables ? (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-[240px] shrink-0">
            <TableList
              tables={tables}
              selected={selected}
              onSelect={(table) => {
                setSelected(table);
                if (pane === "sql") setPane("data");
              }}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {pane === "sql" ? (
              <SqlPane serverId={serverId} run={run} />
            ) : !selected ? (
              <p className="p-6 text-center text-[12px] text-faint">
                Pick a table on the left, or open the SQL tab to run any query.
              </p>
            ) : pane === "data" ? (
              <DataPane table={selected} run={run} />
            ) : (
              <StructurePane table={selected} run={run} />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
