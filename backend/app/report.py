"""Markdown + HTML report rendering for completed scans."""
from __future__ import annotations

import html as html_mod
from datetime import datetime

from .schemas import ScanMetrics, ScanReport
from .store import utcnow

SEVERITY_ORDER = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2, "LOW": 3, "INFO": 4}


def build_report(report: ScanReport, llm_summary: str) -> None:
    """Render markdown_content and html_content onto the report in place."""
    m = report.metrics
    findings = sorted(report.findings, key=lambda f: SEVERITY_ORDER.get(f.severity, 9))
    lines = [
        f"# EdgeSec Agent — Security Scan Report",
        "",
        f"**Repository:** `{report.repo_path}`",
        f"**Scan ID:** `{report.scan_id}`",
        f"**Completed:** {report.created_at}",
        f"**Scanners:** {', '.join(m.scanners_used) or 'none configured'}",
        f"**Risk score:** {m.risk_score} ({m.risk_level})",
        "",
        "---",
        "",
        "## Executive Summary",
        "",
        # The LLM synthesis (or its deterministic fallback).
        llm_summary.strip(),
        "",
        "---",
        "",
        "## Metrics",
        "",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Total findings | {m.total_findings} |",
        f"| Critical | {m.critical_count} |",
        f"| High | {m.high_count} |",
        f"| Medium | {m.medium_count} |",
        f"| Low | {m.low_count} |",
        f"| Info | {m.info_count} |",
        f"| Files affected | {m.files_affected} |",
        f"| Duration | {m.duration_sec:.1f}s |",
        "",
        "---",
        "",
        "## Findings",
        "",
    ]
    if not findings:
        lines.append("_No findings were reported by the configured scanners._")
    else:
        by_sev: dict[str, list] = {}
        for f in findings:
            by_sev.setdefault(f.severity, []).append(f)
        for sev in ("CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"):
            if sev not in by_sev:
                continue
            lines.append(f"### {sev}")
            lines.append("")
            for f in by_sev[sev]:
                loc = f.file
                if f.line:
                    loc += f":{f.line}"
                lines.append(f"- **[{f.tool}] {f.title}** (`{f.rule}`)")
                if f.cwe:
                    lines.append(f"  - CWE: {f.cwe}")
                if f.cvss:
                    lines.append(f"  - CVSS: {f.cvss:.1f}")
                lines.append(f"  - {f.description}")
                lines.append(f"  - File: `{loc}`")
                if f.fix:
                    lines.append(f"  - **Fix:** {f.fix}")
                lines.append("")

    report.markdown_content = "\n".join(lines)
    report.html_content = _render_html(report, llm_summary)


def _render_html(report: ScanReport, llm_summary: str) -> str:
    m = report.metrics
    findings = sorted(report.findings, key=lambda f: SEVERITY_ORDER.get(f.severity, 9))
    colors = {"CRITICAL": "#ef4444", "HIGH": "#f97316", "MEDIUM": "#eab308", "LOW": "#22c55e", "INFO": "#3b82f6"}

    def esc(s: object) -> str:
        return html_mod.escape(str(s))

    rows = []
    for f in findings:
        loc = esc(f.file)
        if f.line:
            loc += f":{f.line}"
        rows.append(
            f"""<tr>
              <td><span style="background:{colors[f.severity]};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">{esc(f.severity)}</span></td>
              <td><b>{esc(f.title)}</b><div style="color:#666;font-size:12px">{esc(f.rule)}</div></td>
              <td style="font-family:monospace;font-size:12px">{loc}</td>
              <td style="font-size:12px;color:#555">{esc(f.description)}</td>
            </tr>"""
        )
    findings_html = "".join(rows) if rows else "<tr><td colspan='4' style='color:#999'>No findings.</td></tr>"
    summary_html = html_mod.escape(llm_summary).replace("\n", "<br/>")

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>EdgeSec Report {esc(report.scan_id)}</title>
<style>
  body {{ font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; margin: 24px; color: #1e293b; }}
  h1 {{ font-size: 22px; }} h2 {{ margin-top: 28px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }}
  table {{ border-collapse: collapse; width: 100%; margin-top: 12px; }}
  th, td {{ border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; vertical-align: top; }}
  th {{ background: #f1f5f9; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }}
  .metric {{ display:inline-block; margin: 6px 14px 6px 0; }}
  .metric b {{ display:block; font-size: 26px; }}
  .metric span {{ color:#64748b; font-size: 12px; }}
</style></head>
<body>
<h1>EdgeSec Agent — Security Scan Report</h1>
<p><b>Repository:</b> {esc(report.repo_path)}<br/>
<b>Scan ID:</b> {esc(report.scan_id)}<br/>
<b>Scanners:</b> {esc(', '.join(m.scanners_used) or 'none')}<br/>
<b>Risk score:</b> {m.risk_score} ({esc(m.risk_level)})</p>
<h2>Executive Summary</h2>
<div>{summary_html}</div>
<h2>Metrics</h2>
<div>
  <div class="metric"><b>{m.total_findings}</b><span>Total</span></div>
  <div class="metric"><b>{m.critical_count}</b><span>Critical</span></div>
  <div class="metric"><b>{m.high_count}</b><span>High</span></div>
  <div class="metric"><b>{m.medium_count}</b><span>Medium</span></div>
  <div class="metric"><b>{m.low_count}</b><span>Low</span></div>
  <div class="metric"><b>{m.info_count}</b><span>Info</span></div>
  <div class="metric"><b>{m.files_affected}</b><span>Files</span></div>
  <div class="metric"><b>{m.duration_sec:.1f}s</b><span>Duration</span></div>
</div>
<h2>Findings</h2>
<table>
  <thead><tr><th>Severity</th><th>Finding</th><th>File</th><th>Description</th></tr></thead>
  <tbody>{findings_html}</tbody>
</table>
</body></html>"""