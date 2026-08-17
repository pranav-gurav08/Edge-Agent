"""LangGraph agent state for the scan workflow."""
from __future__ import annotations

from typing import Annotated, TypedDict

from ..schemas import (LlmTelemetry, ScanFinding, ScanMetrics, ScanReport,
                       ScannerArtifact)


def append_list(existing: list | None, update: list | None) -> list:
    return (existing or []) + (update or [])


class AgentState(TypedDict, total=False):
    scan_id: str
    repo_path: str
    tools: list[str]
    report: ScanReport                 # mutable reference updated by nodes
    artifacts: dict[str, ScannerArtifact]
    findings: Annotated[list[ScanFinding], append_list]
    llm: LlmTelemetry
    llm_summary: str
    metrics: ScanMetrics
    markdown: str
    html: str
    error: str | None