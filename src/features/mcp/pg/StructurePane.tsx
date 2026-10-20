import { LoadingState } from "@/components/ui/feedback";
import { Alert, SectionLabel } from "@/components/ui/panel";
import { ResultGrid } from "@/features/mcp/ResultGrid";
import { useAsync } from "@/hooks/useAsync";
import { structureSql, type TableRef } from "@/lib/mcp/pg-queries";
import type { PgOutput } from "@/types";

const TITLES = ["Columns", "Indexes", "Constraints"];

export const StructurePane = ({
  table,
  run,
}: {
  table: TableRef;
  run: (sql: string) => Promise<PgOutput>;
}) => {
  const { data, error } = useAsync(() => run(structureSql(table)), [table, run]);

  if (error)
    return (
      <Alert tone="danger" className="m-3">
        {error}
      </Alert>
    );
  if (!data) return <LoadingState />;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      {data.results.map((result, index) => (
        <div key={TITLES[index] ?? index} className="mb-4">
          <SectionLabel className="mb-1.5">{TITLES[index]}</SectionLabel>
          <ResultGrid className="max-h-[360px]" columns={result.columns} rows={result.rows} />
        </div>
      ))}
    </div>
  );
};
