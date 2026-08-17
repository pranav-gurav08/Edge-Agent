import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./report.js";
import { AgentState } from "../state.js";
import type { AgentStateType, SecurityFinding } from "../state.js";

function baseState(over: Partial<AgentStateType>): AgentStateType {
  const defaults: AgentStateType = {
    messages: [],
    targetDirectory: "/test/target",
    rawFindings: [],
    plan: { tools: ["gitleaks", "trivy"], rationale: "test", languageHints: ["node"], iac: true, hasGit: false },
    triage: null,
    wikiContext: [],
    synthesisComplete: false,
    finalReportPath: "",
    injectionHalt: false,
    scanTrace: [],
  };
  return { ...defaults, ...over };
}

describe("report rendering", () => {
  it("renders plan + summary table", () => {
    const findings: SecurityFinding[] = [
      { id: "1", tool: "gitleaks", severity: "CRITICAL", description: "AWS", filePath: "/.env", count: 3 },
      { id: "2", tool: "trivy", severity: "HIGH", description: "axios SSRF", filePath: "package.json", ruleId: "CVE-X" },
    ];
    const md = renderMarkdown(baseState({ rawFindings: findings }));
    expect(md).toMatch(/# Security Scan Report/);
    expect(md).toMatch(/\| gitleaks \| 3 \| 0 \| 0 \| 0 \| 0 \|/);
    expect(md).toMatch(/\| trivy \| 0 \| 1 \| 0 \| 0 \| 0 \|/);
    expect(md).toMatch(/### CRITICAL/);
    expect(md).toMatch(/### HIGH/);
    expect(md).toMatch(/AWS/);
    expect(md).toMatch(/CVE-X/);
  });

  it("surfaces injection incidents and counts them under a security heading", () => {
    const md = renderMarkdown(baseState({
      triage: {
        report: "",
        falsePositives: [],
        injectionIncidents: [{ filePath: "/x", pattern: "ignore_previous", severity: "CRITICAL", description: "evil" }],
        remediationCandidates: [],
        wikiContext: [],
      },
      injectionHalt: true,
    }));
    expect(md).toMatch(/SECURITY: Indirect Prompt Injection Detected/);
    expect(md).toMatch(/ignore_previous/);
  });

  it("marks false positives in a dedicated section", () => {
    const findings: SecurityFinding[] = [
      { id: "fp", tool: "gitleaks", severity: "LOW", description: "test key", filePath: "/tests/x" },
    ];
    const md = renderMarkdown(baseState({
      rawFindings: findings,
      triage: {
        report: "",
        falsePositives: ["fp"],
        injectionIncidents: [],
        remediationCandidates: [],
        wikiContext: [],
      },
    }));
    expect(md).toMatch(/## Marked False Positives/);
    expect(md).toMatch(/## Verified Findings/);
  });

  it("emits remediation candidates section", () => {
    const md = renderMarkdown(baseState({
      rawFindings: [{ id: "1", tool: "trivy", severity: "HIGH", description: "y", filePath: "x" }],
      triage: {
        report: "",
        falsePositives: [],
        injectionIncidents: [],
        remediationCandidates: [{ id: "1", tool: "trivy", severity: "HIGH", description: "y", filePath: "x" }],
        wikiContext: [],
      },
    }));
    expect(md).toMatch(/## Remediation Candidates/);
  });

  it("includes wiki context with similarity scores", () => {
    const md = renderMarkdown(baseState({
      wikiContext: [{ entitySlug: "aws", content: "AWS keys leak via env file", similarity: 0.91 }],
    }));
    expect(md).toMatch(/## Wiki Context/);
    expect(md).toMatch(/sim=0\.910/);
  });

  it("renders trace block when present", () => {
    const md = renderMarkdown(baseState({ scanTrace: ["a", "b"] }));
    expect(md).toMatch(/## Trace/);
    expect(md).toMatch(/```\n[a-z]/);
  });
});

describe("AgentState reducers exposed via spec", () => {
  it("exposes spec accessor", () => {
    expect(AgentState).toBeTruthy();
    expect(typeof (AgentState as unknown as { spec?: unknown }).spec).toBe("object");
  });
});
