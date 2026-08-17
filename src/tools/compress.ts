import type { SecurityFinding, ToolName, Severity } from "../state.js";

export interface RawGitleaksFinding {
  RuleID?: string;
  Description?: string;
  File?: string;
  StartLine?: number;
  EndLine?: number;
  Secret?: string;
  Match?: string;
  Rule?: string;
}

export interface RawTrivyResult {
  Target?: string;
  Class?: string;
  Type?: string;
  Vulnerabilities?: Array<{
    VulnerabilityID?: string;
    PkgName?: string;
    InstalledVersion?: string;
    Severity?: string;
    Title?: string;
    Description?: string;
    PrimaryURL?: string;
  }>;
  Misconfigurations?: Array<{
    ID?: string;
    Title?: string;
    Description?: string;
    Severity?: string;
    Target?: string;
  }>;
  Secrets?: Array<{
    RuleID?: string;
    Category?: string;
    Severity?: string;
    Title?: string;
    StartLine?: number;
    EndLine?: number;
  }>;
}

const SEVERITY_MAP: Record<string, Severity> = {
  CRITICAL: "CRITICAL",
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  INFO: "INFO",
  INFORMATIONAL: "INFO",
  UNKNOWN: "INFO",
};

export function toSeverity(s: string | undefined): Severity {
  if (!s) return "INFO";
  return SEVERITY_MAP[s.toUpperCase()] ?? "INFO";
}

function slug(...parts: Array<string | number | undefined>): string {
  return parts
    .map((p) => (p === undefined ? "" : String(p)))
    .join(":")
    .replace(/[^a-zA-Z0-9_.\-:]/g, "_");
}

export function compressGitleaks(raw: RawGitleaksFinding[] | null | undefined): SecurityFinding[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const groups = new Map<string, SecurityFinding>();
  for (const f of raw) {
    const ruleId = f.RuleID ?? f.Rule ?? "unknown";
    const file = f.File ?? "unknown";
    const line = f.StartLine;
    const key = `${ruleId}::${file}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count = (existing.count ?? 1) + 1;
      continue;
    }
    groups.set(key, {
      id: slug("gitleaks", ruleId, file, line),
      tool: "gitleaks",
      severity: "CRITICAL",
      description: (f.Description ?? "secret detected").slice(0, 240),
      filePath: file,
      ruleId,
      line,
      count: 1,
    });
  }
  return Array.from(groups.values());
}

export function compressTrivy(raw: RawTrivyResult[] | null | undefined): SecurityFinding[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const findings: SecurityFinding[] = [];
  for (const res of raw) {
    const target = res.Target ?? "unknown";
    for (const v of res.Vulnerabilities ?? []) {
      findings.push({
        id: slug("trivy", v.VulnerabilityID, target, v.PkgName),
        tool: "trivy",
        severity: toSeverity(v.Severity),
        description: `${v.PkgName ?? "?"}@${v.InstalledVersion ?? "?"} - ${(v.Title ?? v.Description ?? "").slice(0, 200)}`.slice(0, 240),
        filePath: target,
        ruleId: v.VulnerabilityID,
      });
    }
    for (const m of res.Misconfigurations ?? []) {
      findings.push({
        id: slug("trivy-mc", m.ID, target),
        tool: "trivy",
        severity: toSeverity(m.Severity),
        description: (m.Title ?? m.Description ?? "misconfiguration").slice(0, 240),
        filePath: target,
        ruleId: m.ID,
      });
    }
    for (const s of res.Secrets ?? []) {
      findings.push({
        id: slug("trivy-secret", s.RuleID, target, s.StartLine),
        tool: "trivy",
        severity: toSeverity(s.Severity),
        description: `${s.Category ?? "Secret"}: ${s.Title ?? s.RuleID ?? "secret detected"}`.slice(0, 240),
        filePath: target,
        ruleId: s.RuleID,
        line: s.StartLine,
      });
    }
  }
  return findings;
}

export interface RawSonarIssue {
  rule?: string;
  severity?: string;
  message?: string;
  component?: string;
  line?: number;
  type?: string;
}

export function compressSonar(raw: RawSonarIssue[] | null | undefined): SecurityFinding[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const findings: SecurityFinding[] = [];
  for (const i of raw) {
    findings.push({
      id: slug("sonarqube", i.rule, i.component, i.line),
      tool: "sonarqube",
      severity: toSeverity(i.severity),
      description: (i.message ?? "issue").slice(0, 240),
      filePath: i.component ?? "unknown",
      ruleId: i.rule,
      line: i.line,
    });
  }
  return findings;
}

export function dedupeFindings(findings: SecurityFinding[]): SecurityFinding[] {
  const map = new Map<string, SecurityFinding>();
  for (const f of findings) {
    const key = `${f.tool}:${f.ruleId ?? ""}:${f.filePath}`;
    const e = map.get(key);
    if (e) {
      e.count = (e.count ?? 1) + 1;
    } else {
      map.set(key, { ...f, count: f.count ?? 1 });
    }
  }
  return Array.from(map.values());
}

export function allToolsPresent(toolResults: Array<{ binaryAvailable: boolean }>): boolean {
  return toolResults.length > 0 && toolResults.every((r) => r.binaryAvailable);
}

export function summarizeToolStats(findings: SecurityFinding[]): Record<ToolName, Record<Severity, number>> {
  const out: Record<ToolName, Record<Severity, number>> = {
    gitleaks: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
    trivy: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
    sonarqube: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 },
  };
  for (const f of findings) {
    const count = f.count ?? 1;
    out[f.tool][f.severity] += count;
  }
  return out;
}
