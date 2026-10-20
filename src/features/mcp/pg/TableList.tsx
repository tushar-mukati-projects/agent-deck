import { useMemo, useState } from "react";
import { Eye, Table2 } from "lucide-react";

import { Hint } from "@/components/ui/feedback";
import { Chevron, SearchInput } from "@/components/ui/panel";
import { useToggleSet } from "@/hooks/useToggleSet";
import { tableKey, type TableRef } from "@/lib/mcp/pg-queries";
import { cn, groupBy } from "@/lib/utils";

const RENDER_LIMIT = 400;

const groupBySchema = (tables: TableRef[], needle: string) => [
  ...groupBy(
    tables.filter((table) => !needle || tableKey(table).toLowerCase().includes(needle)),
    (table) => table.schema,
  ).entries(),
];

export const TableList = ({
  tables,
  truncated,
  selected,
  onSelect,
}: {
  tables: TableRef[];
  truncated: boolean;
  selected: TableRef | null;
  onSelect: (table: TableRef) => void;
}) => {
  const [filter, setFilter] = useState("");
  const [closed, toggle] = useToggleSet<string>();
  const needle = filter.trim().toLowerCase();
  const groups = useMemo(() => groupBySchema(tables, needle), [tables, needle]);

  let budget = RENDER_LIMIT;
  const selectedKey = selected ? tableKey(selected) : null;

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border bg-panel">
      <div className="p-2">
        <SearchInput
          value={filter}
          onChange={setFilter}
          placeholder="Filter tables…"
          aria-label="Filter tables"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {groups.length === 0 && <Hint>No tables.</Hint>}
        {groups.map(([schema, list]) => {
          const open = !!needle || !closed.has(schema);
          const shown = open ? list.slice(0, Math.max(0, budget)) : [];
          if (open) budget -= list.length;
          return (
            <div key={schema}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(schema)}
                className="flex h-6 w-full items-center gap-1.5 px-1.5 text-[11px] font-semibold text-muted hover:text-fg"
              >
                <Chevron open={open} />
                <span className="truncate">{schema}</span>
                <span className="font-normal text-faint">{list.length}</span>
              </button>
              {shown.map((table) => (
                <button
                  key={table.name}
                  type="button"
                  onClick={() => onSelect(table)}
                  title={tableKey(table)}
                  aria-current={selectedKey === tableKey(table) || undefined}
                  className={cn(
                    "flex h-[24px] w-full items-center gap-1.5 rounded pr-2 pl-5 text-left text-[12px]",
                    selectedKey === tableKey(table)
                      ? "bg-active text-fg"
                      : "text-fg/85 hover:bg-hover",
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
              ))}
            </div>
          );
        })}
        {budget < 0 || truncated ? (
          <Hint>
            {truncated
              ? "Only the first tables are listed. Filter to find others."
              : "Filter to see more tables."}
          </Hint>
        ) : null}
      </div>
    </div>
  );
};
