import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AgentStateType, AgentStateUpdate, SecurityFinding, Severity } from "../state.js";
import type { MemoryStore } from "../db/pglite.js";
import type { Embedder } from "../embeddings.js";
import { summarizeToolStats } from "../tools/compress.js";

const SEVERITY_ORDER: Severity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];

export interface ReportDeps {
  reportDir: string;
  store?: MemoryStore;
  embedder?: Embedder;
}

function formatFinding(f: SecurityFinding): string {
  const count = f.count && f.count > 1 ? ` (×${f.count})` : "";
  const rule = f.ruleId ? `\`${f.ruleId}\` ` : "";
  return `- ${rule}${f.filePath}${f.line ? `:${f.line}` : ""} — ${f.description}${count}`;
}

export function renderMarkdown(state: AgentStateType): string {
  const lines: string[] = [];
  const findings = state.rawFindings;
  const stats = summarizeToolStats(findings);
  const total = findings.reduce((acc, f) => acc + (f.count ?? 1), 0);

  lines.push(`# Security Scan Report`);
  lines.push("");
  lines.push(`- **Target:** \`${state.targetDirectory}\``);
  lines.push(`- **Generated:** ${new Date().toISOString()}`);
  lines.push(`- **Plan:** ${state.plan?.rationale ?? "n/a"}`);
  lines.push(`- **Findings:** ${total} unique (across ${findings.length} dedupe groups)`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push("| Tool | Critical | High | Medium | Low | Info |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const t of ["gitleaks", "trivy", "sonarqube"] as const) {
    const row = stats[t];
    lines.push(`| ${t} | ${row.CRITICAL} | ${row.HIGH} | ${row.MEDIUM} | ${row.LOW} | ${row.INFO} |`);
  }
  lines.push("");

  const fpSet = new Set(state.triage?.falsePositives ?? []);
  const verified = findings.filter((f) => !fpSet.has(f.id));
  const falsePositives = findings.filter((f) => fpSet.has(f.id));

  lines.push("## Verified Findings");
  lines.push("");
  if (verified.length === 0) {
    lines.push("_No verified findings._");
  } else {
    for (const sev of SEVERITY_ORDER) {
      const group = verified.filter((f) => f.severity === sev);
      if (group.length === 0) continue;
      lines.push(`### ${sev}`);
      for (const f of group) lines.push(formatFinding(f));
      lines.push("");
    }
  }

  if (falsePositives.length > 0) {
    lines.push("## Marked False Positives");
    lines.push("");
    for (const f of falsePositives) lines.push(formatFinding(f));
    lines.push("");
  }

  if (state.triage && state.triage.injectionIncidents.length > 0) {
    lines.push("## SECURITY: Indirect Prompt Injection Detected");
    lines.push("");
    lines.push("The following patterns indicative of indirect prompt injection were detected in scanned content. These files were excluded from LLM-context generation.");
    lines.push("");
    for (const inc of state.triage.injectionIncidents) {
      lines.push(`- **${inc.pattern}** @ \`${inc.filePath}\`: ${inc.description}`);
    }
    lines.push("");
  }

  if (state.wikiContext && state.wikiContext.length > 0) {
    lines.push("## Wiki Context (historical precedents)");
    lines.push("");
    for (const h of state.wikiContext) {
      lines.push(`- (sim=${h.similarity.toFixed(3)}) **${h.entitySlug}** — ${h.content.slice(0, 200)}`);
    }
    lines.push("");
  }

  if (state.triage && state.triage.remediationCandidates.length > 0) {
    lines.push("## Remediation Candidates");
    lines.push("");
    for (const c of state.triage.remediationCandidates) {
      lines.push(`- ${formatFinding(c)}`);
    }
    lines.push("");
  }

  if (state.scanTrace.length > 0) {
    lines.push("## Trace");
    lines.push("");
    lines.push("```");
    for (const t of state.scanTrace) lines.push(t);
    lines.push("```");
  }

  return lines.join("\n");
}

export function reportNode(deps: ReportDeps) {
  return async (state: AgentStateType): Promise<AgentStateUpdate> => {
    const out = renderMarkdown(state);
    const dir = resolve(deps.reportDir);
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `report-${stamp}.md`;
    const fullPath = join(dir, filename);
    await writeFile(fullPath, out, "utf8");

    if (deps.store && deps.embedder) {
      const { updateWiki } = (await import("../tools/wiki.js")).makeWikiTools(deps.store, deps.embedder);
      const fpSet = new Set(state.triage?.falsePositives ?? []);
      const verified = state.rawFindings.filter((f) => !fpSet.has(f.id));
      for (const f of verified) {
        const slug = `${f.tool}:${f.ruleId ?? "unknown"}:${f.filePath}`;
        const content = `# ${slug}\n\nSeverity: ${f.severity}\nDescription: ${f.description}\nFile: ${f.filePath}\nSeen: ${new Date().toISOString()}`;
        try {
          await updateWiki.invoke({ entitySlug: slug, content });
        } catch {
          // best-effort
        }
      }
    }

    return {
      finalReportPath: fullPath,
      synthesisComplete: true,
      scanTrace: [`report:path=${fullPath}`],
    };
  };
}
