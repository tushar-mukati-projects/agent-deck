import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/tauri/system";
import { cn } from "@/lib/utils";

const PAGE = 300;
const CELL_PREVIEW = 160;

type Cell = string | null;

const toCsv = (columns: string[], rows: Cell[][]) => {
  const escape = (value: Cell) => {
    if (value === null) return "";
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  return [columns, ...rows].map((row) => row.map(escape).join(",")).join("\n");
};

const toJson = (columns: string[], rows: Cell[][]) =>
  JSON.stringify(
    rows.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]]))),
    null,
    2,
  );

export const gridFromObjects = (value: unknown): { columns: string[]; rows: Cell[][] } | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((v) => v && typeof v === "object" && !Array.isArray(v))) return null;
  const columns = [...new Set(value.flatMap((v) => Object.keys(v as object)))];
  const rows = value.map((v) =>
    columns.map((c) => {
      const cell = (v as Record<string, unknown>)[c];
      if (cell === null || cell === undefined) return null;
      return typeof cell === "object" ? JSON.stringify(cell) : String(cell);
    }),
  );
  return { columns, rows };
};

interface ResultGridProps {
  columns: string[];
  rows: Cell[][];
  footer?: React.ReactNode;
  className?: string;
}

export const ResultGrid = ({ columns, rows, footer, className }: ResultGridProps) => {
  const [limit, setLimit] = useState(PAGE);
  const copy = (text: string, what: string) =>
    void copyText(text).then(() => toast.success(`${what} copied`));

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
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
                    title={cell && cell.length > CELL_PREVIEW ? cell : "Double-click to copy"}
                    onDoubleClick={() => copy(cell ?? "NULL", "Value")}
                    className="max-w-[420px] truncate border-r border-b border-border px-2 py-0.5 whitespace-nowrap text-fg/85"
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
          {rows.length} {rows.length === 1 ? "row" : "rows"}
        </span>
        {footer}
        {rows.length > limit && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6"
            onClick={() => setLimit((l) => l + PAGE)}
          >
            Show {Math.min(PAGE, rows.length - limit)} more
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-6"
            disabled={!rows.length}
            onClick={() => copy(toCsv(columns, rows), "CSV")}
          >
            <Copy /> CSV
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6"
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
