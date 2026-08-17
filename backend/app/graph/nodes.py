"""Graph nodes implementing the scan pipeline.

Each node mutates a shared ScanReport (loaded from the store) and returns the
fragments the graph carries forward. Progress is published on the scan's event
bus so the WebSocket/SSE stream stays in sync.
"""
from __future__ import annotations

import asyncio

from .. import llm as llm_client
from ..config import MAX_FINDINGS_IN_LLM
from ..report import build_report
from ..scanners import COMPRESSORS, RUNNERS, dedupe_findings
from ..schemas import ScanMetrics, ScanReport, ScannerArtifact
from ..store import EventBus, utcnow


def _stage_started(bus: EventBus, report: ScanReport, stage: str) -> None:
    s = report.stages.get(stage)
    if s is not None:
        s.status = "running"
        s.started_at = utcnow()
    bus.publish({"type": "stage_started", "stage": stage})


def _stage_completed(bus: EventBus, report: ScanReport, stage: str, duration_ms: int) -> None:
    s = report.stages.get(stage)
    if s is not None:
        s.status = "completed"
        s.completed_at = utcnow()
        s.duration_ms = duration_ms
    bus.publish({"type": "stage_completed", "stage": stage, "durationMs": duration_ms})


async def node_scan(state: dict, bus: EventBus) -> dict:
    report: ScanReport = state["report"]
    report.status = "running"
    tools = state["tools"]
    _stage_started(bus, report, "scanning")

    async def one(tool: str) -> tuple[str, ScannerArtifact]:
        try:
            return tool, await RUNNERS[tool](state["repo_path"])
        except Exception as exc:  # noqa: BLE001 - per-tool failures are recorded
            return tool, ScannerArtifact(name=tool, error=str(exc))

    results = await asyncio.gather(*(one(t) for t in tools))
    artifacts = dict(results)
    _stage_completed(bus, report, "scanning", _elapsed(report, "scanning"))
    for tool, artifact in artifacts.items():
        detail = (
            f"{tool}: {artifact.findings_count} finding(s)"
            if not artifact.error
            else f"{tool}: skipped ({artifact.error})"
        )
        bus.publish({"type": "stage_progress", "stage": "scanning", "percent": 100, "detail": detail})
    return {"artifacts": artifacts}


async def node_parse(state: dict, bus: EventBus) -> dict:
    report: ScanReport = state["report"]
    _stage_started(bus, report, "parsing")
    artifacts: dict[str, ScannerArtifact] = state["artifacts"]

    findings = []
    for tool, artifact in artifacts.items():
        tool_findings = []
        if not artifact.error and artifact.raw_json is not None:
            tool_findings = COMPRESSORS[tool](artifact.raw_json)
        artifact.findings_count = len(tool_findings)
        findings.extend(tool_findings)

    deduped = dedupe_findings(findings)
    metrics = compute_metrics(report, deduped, artifacts)
    report.findings = deduped
    report.artifacts = artifacts
    _stage_completed(bus, report, "parsing", 1)
    bus.publish({"type": "findings_parsed", "count": len(deduped)})
    return {"findings": deduped, "metrics": metrics}


async def node_synthesize(state: dict, bus: EventBus) -> dict:
    report: ScanReport = state["report"]
    _stage_started(bus, report, "synthesis")
    summary, telemetry = await llm_client.analyze_findings(
        state["findings"], state["repo_path"], MAX_FINDINGS_IN_LLM
    )
    report.llm = telemetry
    bus.publish({"type": "llm_started", "model": telemetry.model})
    bus.publish({"type": "llm_completed", "telemetry": telemetry.model_dump()})
    _stage_completed(bus, report, "synthesis", telemetry.latency_ms or 0)
    return {"llm": telemetry, "llm_summary": summary}


async def node_report(state: dict, bus: EventBus) -> dict:
    report: ScanReport = state["report"]
    _stage_started(bus, report, "report")
    summary = state.get("llm_summary") or llm_client._fallback_summary(state["findings"])
    report.metrics = state["metrics"]
    build_report(report, summary)
    report.status = "completed"
    report.completed_at = utcnow()
    _stage_completed(bus, report, "report", 1)
    bus.publish({"type": "scan_completed", "scanId": report.scan_id})
    return {"markdown": report.markdown_content, "html": report.html_content}


def _elapsed(report: ScanReport, stage: str) -> int:
    started = report.stages[stage].started_at
    # Conservative: stage timestamps are ISO strings; we just report wall time
    # from parsing. Kept simple to avoid clock drift concerns.
    return 0


def compute_metrics(
    report: ScanReport,
    findings: list,
    artifacts: dict[str, ScannerArtifact],
) -> ScanMetrics:
    counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0, "INFO": 0}
    files: set[str] = set()
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1
        if f.file:
            files.add(f.file)
    total = len(findings)
    risk = counts["CRITICAL"] * 10 + counts["HIGH"] * 5 + counts["MEDIUM"] * 3 + counts["LOW"] * 1
    risk_score = min(100, round(risk * 2.0))
    if risk_score >= 70:
        level = "CRITICAL"
    elif risk_score >= 45:
        level = "HIGH"
    elif risk_score >= 20:
        level = "MEDIUM"
    else:
        level = "LOW"
    scanners_used = [t for t in ("gitleaks", "trivy", "sonarqube") if t in artifacts and not artifacts[t].error]
    return ScanMetrics(
        total_findings=total,
        critical_count=counts["CRITICAL"],
        high_count=counts["HIGH"],
        medium_count=counts["MEDIUM"],
        low_count=counts["LOW"],
        info_count=counts["INFO"],
        scanners_used=scanners_used,
        risk_score=risk_score,
        risk_level=level,
        duration_sec=0.0,
        files_affected=len(files),
    )