import { describe, expect, it } from "vitest";
import { runGitleaksScan } from "./gitleaks.js";
import { runTrivyScan } from "./trivy.js";
import { runSonarScan } from "./sonarqube.js";
import { hasBinary } from "./exec.js";
import type { ScanOutcome } from "./gitleaks.js";
import type { SonarScanOutcome } from "./sonarqube.js";
import { resolve } from "node:path";

const TARGET = resolve("test/fixtures/target-repo");
const SCANS = resolve("test/fixtures/scans");

function isOk(o: ScanOutcome): o is Extract<ScanOutcome, { ok: true }> {
  return o.ok;
}
function isOkSonar(o: SonarScanOutcome): o is Extract<SonarScanOutcome, { ok: true }> {
  return o.ok;
}

describe("scanner tools with EDGE_FAKE_SCAN_DIR fixtures", () => {
  it("gitleaks uses fixture when forced", async () => {
    process.env.EDGE_FAKE_SCAN_DIR = SCANS;
    process.env.EDGE_FORCE_FIXTURES = "1";
    const out = await runGitleaksScan(TARGET);
    delete process.env.EDGE_FAKE_SCAN_DIR;
    delete process.env.EDGE_FORCE_FIXTURES;
    expect(out.ok).toBe(true);
    if (isOk(out)) {
      expect(out.source).toBe("fixture");
      expect(out.findings.length).toBeGreaterThan(0);
      expect(out.findings.find((f) => f.ruleId === "aws-access-token")).toBeDefined();
    }
  });

  it("trivy fixture covers vulnerabilities, misconfigs, secrets", async () => {
    process.env.EDGE_FAKE_SCAN_DIR = SCANS;
    process.env.EDGE_FORCE_FIXTURES = "1";
    const out = await runTrivyScan(TARGET);
    delete process.env.EDGE_FAKE_SCAN_DIR;
    delete process.env.EDGE_FORCE_FIXTURES;
    expect(out.ok).toBe(true);
    if (isOk(out)) {
      expect(out.findings.some((f) => f.ruleId === "CVE-2020-7598" && f.tool === "trivy")).toBe(true);
      expect(out.findings.some((f) => f.ruleId === "DS002")).toBe(true);
    }
  });

  it("sonarqube fixture loads issues", async () => {
    process.env.EDGE_FAKE_SCAN_DIR = SCANS;
    process.env.EDGE_FORCE_FIXTURES = "1";
    const out = await runSonarScan(TARGET);
    delete process.env.EDGE_FAKE_SCAN_DIR;
    delete process.env.EDGE_FORCE_FIXTURES;
    expect(out.ok).toBe(true);
    if (isOkSonar(out)) {
      expect(out.findings.length).toBeGreaterThan(0);
      expect(out.findings.some((f) => f.ruleId === "javascript:S2068")).toBe(true);
    }
  });

  it("returns not-available when fixtures missing (forces fixtures, no fixture file)", async () => {
    delete process.env.EDGE_FAKE_SCAN_DIR;
    process.env.EDGE_FORCE_FIXTURES = "1";
    process.env.EDGE_FAKE_SCAN_DIR = resolve("test/fixtures/empty-scans");
    const out = await runGitleaksScan(TARGET);
    delete process.env.EDGE_FAKE_SCAN_DIR;
    delete process.env.EDGE_FORCE_FIXTURES;
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.binaryAvailable).toBe(false);
      expect(out.error).toContain("gitleaks");
    }
  });

  it("binary path runs against real scanner if present (smoke)", async () => {
    if (!(await hasBinary("gitleaks"))) return;
    delete process.env.EDGE_FAKE_SCAN_DIR;
    delete process.env.EDGE_FORCE_FIXTURES;
    const out = await runGitleaksScan(TARGET);
    expect(out.ok).toBe(true);
    if (isOk(out)) expect(out.source).toBe("binary");
  }, 90_000);
});
