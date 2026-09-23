import { describe, expect, it } from "vitest";

import { isMutating, quoteIdent, quoteLiteral } from "@/lib/sql";

describe("isMutating", () => {
  it.each([
    "select * from users",
    "  SELECT 1; select 2",
    "with t as (select 1) select * from t",
    "explain select * from x",
    "show search_path",
    "select 'delete from x' as text",
    "-- drop table x\nselect 1",
  ])("treats %s as read-only", (sql) => expect(isMutating(sql)).toBe(false));

  it.each([
    "delete from users",
    "select 1; drop table x",
    "update t set a = 1",
    "with d as (delete from t returning *) select * from d",
    "explain analyze delete from t",
    "select * into backup from t",
    "vacuum",
    "set role admin",
  ])("flags %s", (sql) => expect(isMutating(sql)).toBe(true));
});

describe("quoting", () => {
  it("doubles embedded quotes", () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    expect(quoteLiteral("it's")).toBe("'it''s'");
  });
});
