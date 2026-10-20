import { describe, expect, it } from "vitest";

import { confirmReason, exampleArguments } from "@/lib/mcp/schema";
import type { McpTool } from "@/types";

describe("exampleArguments", () => {
  it("fills required fields with sensible values", () => {
    const schema = {
      type: "object",
      required: ["sql", "limit", "mode"],
      properties: {
        sql: { type: "string" },
        limit: { type: "integer" },
        mode: { enum: ["fast", "slow"] },
        optional: { type: "boolean" },
      },
    };
    expect(JSON.parse(exampleArguments(schema))).toEqual({ sql: "", limit: 0, mode: "fast" });
  });
});

describe("confirmReason", () => {
  const tool = (annotations?: McpTool["annotations"]): McpTool => ({ name: "t", annotations });

  it("asks for destructive tools and mutating SQL, not for read-only ones", () => {
    expect(confirmReason(tool({ destructiveHint: true }), {})).toMatch(/destructive/);
    expect(confirmReason(tool(), { sql: "delete from users" })).toMatch(/SQL/);
    expect(confirmReason(tool(), { query: { text: "drop table t" } })).toMatch(/SQL/);
    expect(confirmReason(tool(), { sql: "select 1" })).toBeNull();
    expect(confirmReason(tool(), { note: "please update the docs" })).toBeNull();
    expect(confirmReason(tool({ readOnlyHint: true }), { sql: "delete from t" })).toBeNull();
  });
});
