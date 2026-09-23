import { describe, expect, it } from "vitest";

import { splitFrontmatter } from "@/lib/frontmatter";

describe("splitFrontmatter", () => {
  it("extracts simple fields and the body", () => {
    const { fields, body } = splitFrontmatter('---\nname: agent\ndescription: "Does things"\n---\n# Title\n');
    expect(fields).toEqual([
      ["name", "agent"],
      ["description", "Does things"],
    ]);
    expect(body).toBe("# Title\n");
  });

  it("leaves documents without frontmatter alone", () => {
    expect(splitFrontmatter("# Hi\n---\nx")).toEqual({ fields: [], body: "# Hi\n---\nx" });
  });

  it("joins continuation lines onto the previous field", () => {
    expect(splitFrontmatter("---\ntools: a,\n  b\n---\n").fields).toEqual([["tools", "a, b"]]);
  });
});
