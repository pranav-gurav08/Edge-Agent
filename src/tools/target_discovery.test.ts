import { describe, expect, it } from "vitest";
import { discoverTarget } from "./target_discovery.js";
import { resolve } from "node:path";

describe("target_discovery", () => {
  it("identifies node project, Dockerfile, and .env in fixture", async () => {
    const result = await discoverTarget(resolve("test/fixtures/target-repo"));
    expect(result.languages).toContain("node");
    expect(result.packageManagers).toContain("node");
    expect(result.iacFiles).toContain("Dockerfile");
    expect(result.secretHintFiles.some((f) => f.endsWith(".env"))).toBe(true);
    expect(result.hasGit).toBe(false);
    expect(result.estimatedFileCount).toBeGreaterThan(0);
  });

  it("throws on missing directory", async () => {
    await expect(discoverTarget(resolve("test/fixtures/does-not-exist"))).rejects.toThrow(/not accessible/);
  });

  it("throws on file path", async () => {
    await expect(discoverTarget(resolve("package.json"))).rejects.toThrow(/not a directory/);
  });
});
