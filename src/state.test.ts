import { describe, expect, it } from "vitest";
import { AgentState } from "./state.js";

const S = AgentState as unknown as { spec: Record<string, { operator: (x: any, y: any) => any } | undefined> };

function reduce(key: string, prev: any, next: any) {
  const ch = S.spec[key];
  if (!ch) throw new Error(`unknown channel ${key}`);
  return ch.operator(prev, next);
}

describe("AgentState reducers", () => {
  it("rawFindings accumulate (not overwrite)", () => {
    const prev = [{ id: "x", tool: "gitleaks", severity: "HIGH", description: "x", filePath: "/a" }];
    const next = [{ id: "y", tool: "trivy", severity: "MEDIUM", description: "y", filePath: "/b" }];
    const result = reduce("rawFindings", prev, next);
    expect(result.map((f: any) => f.id)).toEqual(["x", "y"]);
  });

  it("plan last-writer-wins", () => {
    const prev = { tools: ["gitleaks"], rationale: "a", languageHints: [], iac: false, hasGit: false };
    const next = { tools: ["trivy"], rationale: "b", languageHints: [], iac: false, hasGit: false };
    const result = reduce("plan", prev, next);
    expect(result.rationale).toBe("b");
  });

  it("plan keeps previous when next is undefined", () => {
    const prev = { tools: ["gitleaks"], rationale: "a", languageHints: [], iac: false, hasGit: false };
    const result = reduce("plan", prev, undefined);
    expect(result.rationale).toBe("a");
  });

  it("scanTrace accumulates", () => {
    const result = reduce("scanTrace", ["x"], ["y", "z"]);
    expect(result).toEqual(["x", "y", "z"]);
  });

  it("wikiContext accumulates", () => {
    const prev = [{ entitySlug: "a", content: "x", similarity: 0.9 }];
    const next = [{ entitySlug: "b", content: "y", similarity: 0.8 }];
    const result = reduce("wikiContext", prev, next);
    expect(result).toHaveLength(2);
  });

  it("finalReportPath last-writer-wins", () => {
    expect(reduce("finalReportPath", "/first", "/second")).toBe("/second");
    expect(reduce("finalReportPath", "/first", undefined)).toBe("/first");
  });

  it("injectionHalt last-writer-wins", () => {
    expect(reduce("injectionHalt", false, true)).toBe(true);
    expect(reduce("injectionHalt", true, undefined)).toBe(true);
  });

  it("targetDirectory last-writer-wins", () => {
    expect(reduce("targetDirectory", "/a", "/b")).toBe("/b");
  });

  it("synthesisComplete last-writer-wins", () => {
    expect(reduce("synthesisComplete", false, true)).toBe(true);
  });
});
