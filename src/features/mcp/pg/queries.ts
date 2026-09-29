import { quoteIdent, quoteLiteral } from "@/lib/sql";
import type { PgResult } from "@/types";

export const PAGE_SIZE = 100;

export interface TableRef {
  schema: string;
  name: string;
  kind: string;
  estimate: number;
}

export interface Order {
  column: string;
  desc: boolean;
}

export const TABLES_SQL = `select n.nspname, c.relname,
  case c.relkind when 'v' then 'view' when 'm' then 'matview' when 'f' then 'foreign' else 'table' end,
  greatest(c.reltuples, 0)::bigint
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p', 'v', 'm', 'f')
  and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
order by 1, 2`;

export const qualified = (table: Pick<TableRef, "schema" | "name">) =>
  `${quoteIdent(table.schema)}.${quoteIdent(table.name)}`;

export const tableKey = (table: Pick<TableRef, "schema" | "name">) =>
  `${table.schema}.${table.name}`;

export const parseTables = (result: PgResult | undefined): TableRef[] =>
  (result?.rows ?? []).map(([schema, name, kind, estimate]) => ({
    schema: schema ?? "",
    name: name ?? "",
    kind: kind ?? "table",
    estimate: Number(estimate ?? 0),
  }));

export const buildSelect = (
  table: Pick<TableRef, "schema" | "name">,
  { where, order, page }: { where: string; order: Order | null; page: number },
) =>
  [
    `select * from ${qualified(table)}`,
    where.trim() && `where ${where.trim()}`,
    order && `order by ${quoteIdent(order.column)} ${order.desc ? "desc" : "asc"}`,
    `limit ${PAGE_SIZE + 1} offset ${page * PAGE_SIZE}`,
  ]
    .filter(Boolean)
    .join(" ");

export const structureSql = (table: Pick<TableRef, "schema" | "name">) => `
select column_name as "column", data_type as "type", is_nullable as "nullable", column_default as "default"
from information_schema.columns
where table_schema = ${quoteLiteral(table.schema)} and table_name = ${quoteLiteral(table.name)}
order by ordinal_position;
select indexname as "index", indexdef as "definition" from pg_indexes
where schemaname = ${quoteLiteral(table.schema)} and tablename = ${quoteLiteral(table.name)} order by 1;
select conname as "constraint", pg_get_constraintdef(oid) as "definition" from pg_constraint
where conrelid = ${quoteLiteral(qualified(table))}::regclass order by 1;`;
