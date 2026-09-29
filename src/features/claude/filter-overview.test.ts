import { describe, expect, it } from "vitest";

import { filterOverview, invocation } from "@/features/claude/filter-overview";
import type { ClaudeOverview, SettingsFile } from "@/types";

const settings = (extra: Partial<SettingsFile>): SettingsFile => ({
  scope: "user",
  label: "User settings",
  path: "C:\\u\\.claude\\settings.json",
  exists: true,
  model: null,
  defaultMode: null,
  allow: [],
  deny: [],
  ask: [],
  envKeys: [],
  ...extra,
});

const overview: ClaudeOverview = {
  claudeHome: "C:\\u\\.claude",
  distro: null,
  memory: [],
  mcp: [],
  skills: [{ name: "review", description: "Review a PR", path: "a", scope: "user", plugin: null }],
  agents: [],
  commands: [],
  hooks: [],
  settings: [settings({ model: "opus", allow: ["Bash(git:*)"], deny: ["Read(.env)"] })],
  plugins: [],
};

describe("filterOverview", () => {
  it("keeps everything without a query", () => {
    const result = filterOverview(overview, "");
    expect(result.skills).toHaveLength(1);
    expect(result.permissions.map((p) => p.kind)).toEqual(["allow", "deny"]);
    expect(result.modes).toHaveLength(1);
  });

  it("filters every section, including mode and model rows", () => {
    expect(filterOverview(overview, "pr").skills).toHaveLength(1);
    expect(filterOverview(overview, "git").permissions.map((p) => p.rule)).toEqual(["Bash(git:*)"]);
    expect(filterOverview(overview, "opus").modes).toHaveLength(1);
    expect(filterOverview(overview, "zzz").modes).toHaveLength(0);
  });

  it("prefixes plugin items with the plugin name once", () => {
    expect(
      invocation({ name: "fix", plugin: "tools", description: null, path: "", scope: "plugin" }),
    ).toBe("tools:fix");
    expect(
      invocation({
        name: "tools:fix",
        plugin: "tools",
        description: null,
        path: "",
        scope: "plugin",
      }),
    ).toBe("tools:fix");
  });
});
