import { JSON_INDENT } from "@/lib/mcp/results";
import { isMutating } from "@/lib/sql";
import type { JsonSchema, McpTool } from "@/types";

const exampleValue = (schema: JsonSchema): unknown => {
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "number" || type === "integer") return 0;
  if (type === "boolean") return false;
  if (type === "array") return [];
  if (type === "object") return {};
  return "";
};

export const exampleArguments = (schema?: JsonSchema) => {
  const required = new Set(schema?.required ?? []);
  const entries = Object.entries(schema?.properties ?? {}).filter(([name]) => required.has(name));
  return JSON.stringify(
    Object.fromEntries(entries.map(([n, s]) => [n, exampleValue(s)])),
    null,
    JSON_INDENT,
  );
};

const SQL_START =
  /^\s*(with|select|insert|update|delete|merge|create|drop|alter|truncate|grant|revoke|vacuum|copy)\b/i;

const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(strings)
      : value && typeof value === "object"
        ? Object.values(value).flatMap(strings)
        : [];

export const confirmReason = (tool: McpTool, args: unknown) => {
  if (tool.annotations?.destructiveHint) return "The server marks this tool as destructive.";
  if (tool.annotations?.readOnlyHint) return null;
  const writes = strings(args).some((text) => SQL_START.test(text) && isMutating(text));
  return writes ? "The arguments contain SQL that changes the database." : null;
};
