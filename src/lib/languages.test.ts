import { describe, expect, it } from "vitest";

import { findLanguage } from "@/lib/languages";

const name = (fileName: string) => findLanguage(fileName)?.name ?? null;

describe("picking a syntax language from a file name", () => {
  it("recognizes Dockerfiles however they are named", () => {
    for (const file of [
      "Dockerfile",
      "dockerfile",
      "Dockerfile.dev",
      "dockerfile.backend",
      "api.Dockerfile",
      "web.dockerfile",
      "Containerfile",
    ])
      expect(name(file)).toBe("Dockerfile");
  });

  it("keeps regular extensions and covers env and shell rc files", () => {
    expect(name("docker-compose.yml")).toBe("YAML");
    expect(name("main.ts")).toBe("TypeScript");
    expect(name(".env")).toBe("Properties files");
    expect(name(".env.local")).toBe("Properties files");
    expect(name(".zshrc")).toBe("Shell");
    expect(name("dockerize.md")).toBe("Markdown");
    expect(name("notes")).toBeNull();
  });
});
