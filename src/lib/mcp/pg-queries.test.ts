import { describe, expect, it } from "vitest";

import {
  buildSelect,
  orderValue,
  parseOrder,
  parseTables,
  structureSql,
} from "@/lib/mcp/pg-queries";
import { isMutating } from "@/lib/sql";

const table = { schema: "public", name: 'we"ird' };

describe("pg queries", () => {
  it("builds paged selects with quoted names", () => {
    expect(buildSelect(table, { where: "", order: null, page: 0 })).toBe(
      'select * from "public"."we""ird" limit 101 offset 0',
    );
    expect(
      buildSelect(table, { where: " id > 3 ", order: { column: "id", desc: true }, page: 2 }),
    ).toBe('select * from "public"."we""ird" where id > 3 order by "id" desc limit 101 offset 200');
  });

  it("lets the data filter be checked for smuggled statements", () => {
    expect(
      isMutating(buildSelect(table, { where: "1=1; delete from x", order: null, page: 0 })),
    ).toBe(true);
    expect(isMutating(buildSelect(table, { where: "name = 'a;b'", order: null, page: 0 }))).toBe(
      false,
    );
  });

  it("parses table rows and quotes literals in structure queries", () => {
    expect(
      parseTables({ columns: [], rows: [["s", "t", null, "12"]], rowCount: 1, truncated: false }),
    ).toEqual([{ schema: "s", name: "t", kind: "table", estimate: 12 }]);
    expect(structureSql({ schema: "o'x", name: "t" })).toContain("'o''x'");
  });
});

describe("sort order", () => {
  it.each([
    [null, ""],
    [{ column: "id", desc: false }, "id:asc"],
    [{ column: "a:desc", desc: true }, "a:desc:desc"],
  ])("round-trips %j through %s", (order, value) => {
    expect(orderValue(order)).toBe(value);
    expect(parseOrder(value)).toEqual(order);
  });
});
