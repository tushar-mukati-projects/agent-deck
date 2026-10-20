import { useCallback, useState } from "react";
import { Database, RefreshCw } from "lucide-react";

import { ErrorAlert } from "@/components/ui/error-alert";
import { Hint, LoadingState, showError } from "@/components/ui/feedback";
import { IconButton } from "@/components/ui/icon-button";
import { Segmented } from "@/components/ui/panel";
import { DataPane } from "@/features/mcp/pg/DataPane";
import { SqlPane } from "@/features/mcp/pg/SqlPane";
import { StructurePane } from "@/features/mcp/pg/StructurePane";
import { TableList } from "@/features/mcp/pg/TableList";
import { useAsync } from "@/hooks/useAsync";
import { parseTables, TABLES_SQL, tableKey, type TableRef } from "@/lib/mcp/pg-queries";
import { api } from "@/lib/tauri/commands";

type Pane = "data" | "structure" | "sql";

const ConnectionLabel = ({ cwd, serverId }: { cwd: string; serverId: string }) => {
  const { data: info, error } = useAsync(() => api.pgInfo(cwd, serverId), [cwd, serverId]);
  const label = info
    ? `${info.user}@${info.host}:${info.port}/${info.database}`
    : error
      ? "Connection details unavailable"
      : "Connecting…";
  return (
    <span className="min-w-0 truncate font-mono text-[11.5px] text-muted" title={error ?? label}>
      {label}
    </span>
  );
};

export const PgBrowser = ({ cwd, serverId }: { cwd: string; serverId: string }) => {
  const run = useCallback((sql: string) => api.pgQuery(cwd, serverId, sql), [cwd, serverId]);
  const cancel = useCallback(
    () => void api.pgCancel(cwd, serverId).catch(showError),
    [cwd, serverId],
  );
  const tables = useAsync(async () => (await run(TABLES_SQL)).results[0], [run], {
    keepPrevious: true,
  });
  const [selected, setSelected] = useState<TableRef | null>(null);
  const [pane, setPane] = useState<Pane>("data");
  const [sqlOpened, setSqlOpened] = useState(false);
  const list = tables.data ? parseTables(tables.data) : null;

  const choosePane = (next: Pane) => {
    setPane(next);
    if (next === "sql") setSqlOpened(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <Database className="size-3.5 shrink-0 text-info" />
        <ConnectionLabel cwd={cwd} serverId={serverId} />
        <div className="ml-auto flex items-center gap-1.5">
          <Segmented<Pane>
            size="sm"
            value={pane}
            onChange={choosePane}
            options={[
              { value: "data", label: "Data" },
              { value: "structure", label: "Structure" },
              { value: "sql", label: "SQL" },
            ]}
          />
          <IconButton
            label="Reload tables"
            disabled={tables.loading}
            onClick={() => void tables.reload(true)}
          >
            <RefreshCw />
          </IconButton>
        </div>
      </div>
      {tables.error && !list ? (
        <div className="p-3">
          <ErrorAlert message={tables.error} onRetry={() => void tables.reload()} />
        </div>
      ) : !list ? (
        <LoadingState />
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="w-[240px] shrink-0">
            <TableList
              tables={list}
              truncated={!!tables.data?.truncated}
              selected={selected}
              onSelect={(table) => {
                setSelected(table);
                if (pane === "sql") setPane("data");
              }}
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            {sqlOpened && (
              <div className={pane === "sql" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                <SqlPane serverId={serverId} run={run} cancel={cancel} />
              </div>
            )}
            {selected ? (
              <>
                <div className={pane === "data" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
                  <DataPane key={tableKey(selected)} table={selected} run={run} cancel={cancel} />
                </div>
                {pane === "structure" && (
                  <StructurePane key={tableKey(selected)} table={selected} run={run} />
                )}
              </>
            ) : (
              pane !== "sql" && (
                <Hint className="p-6 text-center">
                  Pick a table on the left, or open the SQL tab to run any query.
                </Hint>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
};
