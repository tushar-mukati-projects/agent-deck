import { useState } from "react";
import { Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toCsv, toJson, type Cell } from "@/lib/mcp/results";
import { copyText } from "@/lib/tauri/system";
import { cn, plural } from "@/lib/utils";

const PAGE = 300;
const CELL_PREVIEW = 160;

interface ResultGridProps {
  columns: string[];
  rows: Cell[][];
  footer?: React.ReactNode;
  rowsLabel?: string;
  className?: string;
}

const copy = (text: string, what: string) =>
  void copyText(text, `${what} copied`);

export const ResultGrid = ({ columns, rows, footer, rowsLabel, className }: ResultGridProps) => {
  const [paging, setPaging] = useState({ rows, limit: PAGE });
  const limit = paging.rows === rows ? paging.limit : PAGE;
  const [picked, setPicked] = useState<{ rows: Cell[][]; r: number; c: number } | null>(null);
  const selected = picked?.rows === rows ? picked : null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!selected || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "c") return;
    event.preventDefault();
    copy(rows[selected.r]?.[selected.c] ?? "NULL", "Value");
  };

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-auto rounded-md border border-border outline-none focus-visible:border-border-strong"
      >
        <table className="w-max min-w-full border-collapse font-mono text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-elevated">
            <tr>
              <th className="w-10 border-r border-b border-border px-2 py-1 text-right font-normal text-faint">
                #
              </th>
              {columns.map((column, index) => (
                <th
                  key={`${column}:${index}`}
                  className="border-r border-b border-border px-2 py-1 text-left font-semibold whitespace-nowrap text-fg/90"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row, r) => (
              <tr key={r} className="hover:bg-hover/60">
                <td className="border-r border-b border-border px-2 py-0.5 text-right text-faint tabular-nums">
                  {r + 1}
                </td>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    title={cell && cell.length > CELL_PREVIEW ? cell : undefined}
                    onClick={() => setPicked({ rows, r, c })}
                    onDoubleClick={() => copy(cell ?? "NULL", "Value")}
                    className={cn(
                      "max-w-[420px] truncate border-r border-b border-border px-2 py-0.5 whitespace-nowrap text-fg/85",
                      selected?.r === r && selected.c === c && "bg-accent-soft",
                    )}
                  >
                    {cell === null ? (
                      <span className="text-faint italic">NULL</span>
                    ) : cell.length > CELL_PREVIEW ? (
                      `${cell.slice(0, CELL_PREVIEW)}…`
                    ) : (
                      cell
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="px-3 py-3 text-[11.5px] text-faint">No rows.</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pt-1.5 text-[11px] text-faint">
        <span className="tabular-nums">
          {rowsLabel ?? plural(rows.length, "row")}
        </span>
        {footer}
        {rows.length > limit && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setPaging({ rows, limit: limit + PAGE })}
          >
            Show {Math.min(PAGE, rows.length - limit)} more
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {rows.length > 0 && <span>Click a cell, then Ctrl C to copy it</span>}
          <Button
            size="xs"
            variant="ghost"
            disabled={!rows.length}
            onClick={() => copy(toCsv(columns, rows), "CSV")}
          >
            <Copy /> CSV
          </Button>
          <Button
            size="xs"
            variant="ghost"
            disabled={!rows.length}
            onClick={() => copy(toJson(columns, rows), "JSON")}
          >
            <Copy /> JSON
          </Button>
        </div>
      </div>
    </div>
  );
};
