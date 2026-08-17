import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { compressGitleaks, type RawGitleaksFinding } from "./compress.js";
import { execAsync, hasBinary, readFixture, safeTarget, forceFixtures } from "./exec.js";
import type { SecurityFinding } from "../state.js";

export const GitleaksArgsSchema = z.object({
  targetPath: z.string().describe("Absolute path to directory to scan for secrets"),
});

export type ScanOutcome =
  | { ok: true; binaryAvailable: boolean; findings: SecurityFinding[]; source: "binary" | "fixture" }
  | { ok: false; binaryAvailable: boolean; error: string };

export async function runGitleaksScan(targetPath: string): Promise<ScanOutcome> {
  const target = safeTarget(targetPath);
  if (forceFixtures() || !(await hasBinary("gitleaks"))) {
    const fixture = await readFixture<RawGitleaksFinding[]>("gitleaks");
    if (fixture) return { ok: true, binaryAvailable: false, source: "fixture", findings: compressGitleaks(fixture) };
    return { ok: false, binaryAvailable: false, error: "gitleaks binary not installed and EDGE_FAKE_SCAN_DIR unset" };
  }
  try {
    const cmd = `gitleaks detect --no-git --source "${target}" --report-format json --report-path - --no-banner --exit-code 0`;
    const { stdout } = await execAsync(cmd, { maxBuffer: 64 * 1024 * 1024 });
    const raw: RawGitleaksFinding[] = stdout.trim() ? JSON.parse(stdout) : [];
    return { ok: true, binaryAvailable: true, source: "binary", findings: compressGitleaks(raw) };
  } catch (e) {
    return { ok: false, binaryAvailable: true, error: e instanceof Error ? e.message : String(e) };
  }
}

export const gitleaksScanner = tool(
  async (input) => {
    const result = await runGitleaksScan(input.targetPath);
    return JSON.stringify(result);
  },
  {
    name: "gitleaks_scanner",
    description: "Scans a local directory with Gitleaks to detect hardcoded secrets (API keys, tokens, passwords).",
    schema: GitleaksArgsSchema,
  },
);
