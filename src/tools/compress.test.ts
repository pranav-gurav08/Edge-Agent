import { describe, expect, it } from "vitest";
import { compressGitleaks, compressTrivy, compressSonar, dedupeFindings, summarizeToolStats, type RawGitleaksFinding, type RawTrivyResult, type RawSonarIssue } from "./compress.js";

describe("compressGitleaks", () => {
  it("dedupes by rule+file with count", () => {
    const raw: RawGitleaksFinding[] = [
      { RuleID: "aws", File: "/a/.env", StartLine: 1, Description: "AWS key" },
      { RuleID: "aws", File: "/a/.env", StartLine: 5, Description: "AWS key" },
      { RuleID: "aws", File: "/a/.env", StartLine: 9, Description: "AWS key" },
    ];
    const out = compressGitleaks(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.count).toBe(3);
    expect(out[0]!.tool).toBe("gitleaks");
    expect(out[0]!.severity).toBe("CRITICAL");
  });

  it("returns [] for empty input", () => {
    expect(compressGitleaks(null)).toEqual([]);
    expect(compressGitleaks([])).toEqual([]);
  });

  it("keeps different files separate", () => {
    const out = compressGitleaks([
      { RuleID: "x", File: "/a", StartLine: 1, Description: "x" },
      { RuleID: "x", File: "/b", StartLine: 1, Description: "x" },
    ]);
    expect(out).toHaveLength(2);
  });
});

describe("compressTrivy", () => {
  it("flattens vulnerabilities and misconfigurations", () => {
    const raw: RawTrivyResult[] = [
      { Target: "package.json", Vulnerabilities: [{ VulnerabilityID: "CVE-1", PkgName: "foo", InstalledVersion: "1.0", Severity: "HIGH", Title: "X" }] },
      { Target: "Dockerfile", Misconfigurations: [{ ID: "DS002", Title: "root user", Severity: "CRITICAL" }] },
    ];
    const out = compressTrivy(raw);
    expect(out).toHaveLength(2);
    expect(out.find((f) => f.ruleId === "CVE-1")!.severity).toBe("HIGH");
    expect(out.find((f) => f.ruleId === "DS002")!.severity).toBe("CRITICAL");
  });

  it("maps unknown severities to INFO", () => {
    const out = compressTrivy([{ Target: "x", Vulnerabilities: [{ VulnerabilityID: "C", PkgName: "p", InstalledVersion: "1", Severity: "BANANA" }] }]);
    expect(out[0]!.severity).toBe("INFO");
  });
});

describe("compressSonar", () => {
  it("maps severities and produces security findings", () => {
    const raw: RawSonarIssue[] = [
      { rule: "javascript:S2068", severity: "CRITICAL", message: "hardcoded secret", component: "server.js", line: 4 },
      { rule: "javascript:S3776", severity: "MEDIUM", message: "complex function", component: "server.js", line: 7 },
    ];
    const out = compressSonar(raw);
    expect(out).toHaveLength(2);
    expect(out[0]!.tool).toBe("sonarqube");
  });
});

describe("dedupeFindings", () => {
  it("merges same tool+rule+file by count", () => {
    const out = dedupeFindings([
      { id: "1", tool: "gitleaks", severity: "HIGH", description: "x", filePath: "/a", count: 1 },
      { id: "2", tool: "gitleaks", severity: "HIGH", description: "x", filePath: "/a", count: 1 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.count).toBe(2);
  });
});

describe("summarizeToolStats", () => {
  it("buckets counts by tool and severity", () => {
    const s = summarizeToolStats([
      { id: "1", tool: "gitleaks", severity: "CRITICAL", description: "x", filePath: "/a", count: 3 },
      { id: "2", tool: "trivy", severity: "HIGH", description: "y", filePath: "/b", count: 2 },
      { id: "3", tool: "sonarqube", severity: "LOW", description: "z", filePath: "/c", count: 1 },
    ]);
    expect(s.gitleaks.CRITICAL).toBe(3);
    expect(s.trivy.HIGH).toBe(2);
    expect(s.sonarqube.LOW).toBe(1);
    expect(s.gitleaks.HIGH).toBe(0);
  });
});
