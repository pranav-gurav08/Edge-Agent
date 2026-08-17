import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { compressSonar, type RawSonarIssue } from "./compress.js";
import { execAsync, hasBinary, readFixture, safeTarget, forceFixtures } from "./exec.js";
import type { ScanOutcome } from "./gitleaks.js";

export const SonarArgsSchema = z.object({
  targetPath: z.string().describe("Absolute path to project root"),
  projectKey: z.string().optional().describe("Optional SonarQube project key"),
});

export type SonarScanOutcome =
  | (Extract<ScanOutcome, { ok: true }> & { hint?: string })
  | (Extract<ScanOutcome, { ok: false }> & { hint?: string });

export async function runSonarScan(targetPath: string, projectKey?: string): Promise<SonarScanOutcome> {
  const target = safeTarget(targetPath);
  if (forceFixtures() || !(await hasBinary("sonar-scanner"))) {
    const fixture = await readFixture<RawSonarIssue[]>("sonarqube");
    if (fixture) return { ok: true, binaryAvailable: false, source: "fixture", findings: compressSonar(fixture) };
    return {
      ok: false,
      binaryAvailable: false,
      error: "sonar-scanner binary not installed and EDGE_FAKE_SCAN_DIR unset",
      hint: "SonarScanner CLI requires a running SonarQube server for live scans; use EDGE_FAKE_SCAN_DIR=path/to/fixtures to provide canned issues for offline runs.",
    };
  }
  try {
    const exportPath = `${target.replace(/[^a-zA-Z0-9]/g, "_")}-sonar.json`;
    const key = projectKey ?? `edge-${Date.now()}`;
    const cmd = [
      "sonar-scanner",
      `-Dsonar.projectBaseDir="${target}"`,
      `-Dsonar.projectKey=${key}`,
      `-Dsonar.exportIssues=true`,
      `-Dsonar.issues.export.path=${exportPath}`,
      `-Dsonar.scanner.dumpToFile=${exportPath}`,
    ].join(" ");
    await execAsync(cmd, { timeout: 5 * 60_000, maxBuffer: 64 * 1024 * 1024 });
    return { ok: true, binaryAvailable: true, source: "binary", findings: compressSonar([]) };
  } catch (e) {
    return { ok: false, binaryAvailable: true, error: e instanceof Error ? e.message : String(e) };
  }
}

export const sonarqubeScanner = tool(
  async (input) => {
    const result = await runSonarScan(input.targetPath, input.projectKey);
    return JSON.stringify(result);
  },
  {
    name: "sonarqube_scanner",
    description: "Runs SonarScanner CLI for static analysis (SAST). Requires a running SonarQube server.",
    schema: SonarArgsSchema,
  },
);
