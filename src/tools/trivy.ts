import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { compressTrivy, type RawTrivyResult } from "./compress.js";
import { execAsync, hasBinary, readFixture, safeTarget, forceFixtures } from "./exec.js";
import type { ScanOutcome } from "./gitleaks.js";

export const TrivyArgsSchema = z.object({
  targetPath: z.string().describe("Absolute path to directory to scan"),
  severities: z.array(z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"])).optional(),
});

export async function runTrivyScan(
  targetPath: string,
  severities: Array<"CRITICAL" | "HIGH" | "MEDIUM" | "LOW"> = ["HIGH", "CRITICAL"],
): Promise<ScanOutcome> {
  const target = safeTarget(targetPath);
  if (forceFixtures() || !(await hasBinary("trivy"))) {
    const fixture = await readFixture<RawTrivyResult[]>("trivy");
    if (fixture) return { ok: true, binaryAvailable: false, source: "fixture", findings: compressTrivy(fixture) };
    return { ok: false, binaryAvailable: false, error: "trivy binary not installed and EDGE_FAKE_SCAN_DIR unset" };
  }
  try {
    const sev = severities.join(",");
    const cmd = `trivy fs --format json --severity ${sev} --quiet "${target}"`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 64 * 1024 * 1024, timeout: 5 * 60_000 });
    const parsed = JSON.parse(stdout);
    const raw: RawTrivyResult[] = parsed?.Results ?? [];
    return { ok: true, binaryAvailable: true, source: "binary", findings: compressTrivy(raw) };
  } catch (e) {
    return { ok: false, binaryAvailable: true, error: e instanceof Error ? e.message : String(e) };
  }
}

export const trivyScanner = tool(
  async (input) => {
    const result = await runTrivyScan(input.targetPath, input.severities as any);
    return JSON.stringify(result);
  },
  {
    name: "trivy_scanner",
    description: "Scans a local directory with Trivy for CVEs in OS packages and application dependencies, and IaC misconfigurations.",
    schema: TrivyArgsSchema,
  },
);
