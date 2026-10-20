import { LoadingState } from "@/components/ui/feedback";
import { Alert, SectionLabel } from "@/components/ui/panel";
import { ResultGrid } from "@/features/mcp/ResultGrid";
import { useAsync } from "@/hooks/useAsync";
import { structureSql, type PgRunner, type TableRef } from "@/lib/mcp/pg-queries";

const TITLES = ["Columns", "Indexes", "Constraints"];

type StructurePaneProps = Pick<PgRunner, "run"> & {
  table: TableRef;
};

export const StructurePane = ({ table, run }: StructurePaneProps) => {
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
