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
    "select '--'; drop table users",
    "select '/*'; delete from t; select '*/'",
    'select "a--b"; truncate t',
    "select $$ -- $$; drop table t",
    "select 'unterminated; drop table t",
  ])("flags %s", (sql) => expect(isMutating(sql)).toBe(true));

  it("ignores writes inside comments and strings", () => {
    expect(isMutating("select 1 /* ; drop table t */")).toBe(false);
    expect(isMutating("select $body$ delete from t; $body$")).toBe(false);
    expect(isMutating('select "delete" from t')).toBe(false);
  });
});

describe("quoting", () => {
  it("doubles embedded quotes", () => {
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    expect(quoteLiteral("it's")).toBe("'it''s'");
  });
});
