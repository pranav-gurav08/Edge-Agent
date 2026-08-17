"""Pydantic schemas for the EdgeSec Agent API. These mirror the TypeScript
models in the PWA (src/app/core/models/types.ts) and serialize with camelCase
field names on the wire.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

ScannerTool = Literal["gitleaks", "trivy", "sonarqube"]
StageName = Literal["scanning", "parsing", "synthesis", "report"]
Severity = Literal["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]


class APIModel(BaseModel):
    """Base model: accepts snake_case in code, emits camelCase over the wire."""
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class ScanRequest(APIModel):
    repo_path: str = Field(..., min_length=1, max_length=4096, description="Absolute path to the local repository or single file to scan.")
    tools: list[ScannerTool] = Field(default=["gitleaks", "trivy"], max_length=3)


class ScanStarted(APIModel):
    scan_id: str
    status: Literal["queued"] = "queued"


class ScannerArtifact(APIModel):
    name: str
    exit_code: int | None = None
    duration_ms: int = 0
    findings_count: int = 0
    raw_json: object | None = None
    error: str | None = None
    tool_version: str | None = None


class LlmTelemetry(APIModel):
    status: Literal["ok", "degraded", "skipped", "error"] = "skipped"
    model: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    latency_ms: int | None = None
    note: str | None = None


class BrowseEntry(APIModel):
    name: str
    path: str
    is_dir: bool


class BrowseResponse(APIModel):
    current: str | None = None
    parent: str | None = None
    entries: list[BrowseEntry] = Field(default_factory=list)


class StageState(APIModel):
    status: Literal["pending", "running", "completed", "failed"] = "pending"
    started_at: str | None = None
    completed_at: str | None = None
    duration_ms: int | None = None


class ScanFinding(APIModel):
    id: str
    tool: str
    severity: Severity
    title: str
    description: str
    file: str
    line: int | None = None
    column: int | None = None
    rule: str
    category: str
    confidence: str
    fix: str | None = None
    cwe: str | None = None
    cvss: float | None = None
    recommendation: str | None = None
    raw: object | None = None


class ScanMetrics(APIModel):
    total_findings: int = 0
    critical_count: int = 0
    high_count: int = 0
    medium_count: int = 0
    low_count: int = 0
    info_count: int = 0
    scanners_used: list[ScannerTool] = []
    risk_score: int = 0
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "LOW"
    duration_sec: float = 0.0
    files_affected: int = 0


class ScanReport(APIModel):
    scan_id: str
    repo_path: str
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    stages: dict[StageName, StageState]
    findings: list[ScanFinding] = []
    artifacts: dict[str, ScannerArtifact] = {}
    llm: LlmTelemetry = LlmTelemetry()
    metrics: ScanMetrics = ScanMetrics()
    markdown_content: str = ""
    html_content: str = ""
    created_at: str
    completed_at: str | None = None
    error: str | None = None


class HealthPayload(APIModel):
    status: Literal["ok", "degraded"]
    version: str
    backend: Literal["ok"] = "ok"
    scanners: dict[ScannerTool, bool]
    llm: dict[str, object]
    server_time: str