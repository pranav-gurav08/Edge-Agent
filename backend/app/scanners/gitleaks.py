"""Gitleaks credential-leak scanner wrapper."""

from __future__ import annotations

import asyncio
import os
import tempfile

from ..config import GITLEAKS_BIN
from ..schemas import ScanFinding, ScannerArtifact
from .base import artifact_error, artifact_success, finding_id, has_binary, parse_json_output, resolve_target, run_binary

SEVERITY_MAP = {
    "Critical": "CRITICAL",
    "High": "HIGH",
    "Medium": "MEDIUM",
    "Low": "LOW",
}


async def run_gitleaks(path: str) -> ScannerArtifact:
    start = asyncio.get_event_loop().time()
    if not has_binary(GITLEAKS_BIN):
        return artifact_error("gitleaks", "gitleaks binary not found on PATH")

    # --no-git lets us scan directories that are not git repositories. The JSON
    # report goes to a temp file; stdout carries only informational output.
    target = resolve_target(path)
    report_fd, report_path = tempfile.mkstemp(suffix=".json")
    os.close(report_fd)
    try:
        args = ["detect", "--source", target, "--no-git", "--report-format", "json", "--report-path", report_path]
        out, code = await run_binary(GITLEAKS_BIN, args)
        duration_ms = int((asyncio.get_event_loop().time() - start) * 1000)

        # gitleaks exits 1 when leaks ARE found — that is success for us.
        if code not in (0, 1) and not out:
            return artifact_error("gitleaks", f"gitleaks exited with code {code}", duration_ms)

        if os.path.exists(report_path) and os.path.getsize(report_path) > 0:
            with open(report_path, encoding="utf-8") as fh:
                text = fh.read()
        else:
            text = out  # some builds emit JSON on stdout instead

        raw = parse_json_output(text)
        if raw is None:
            # "no leaks found" exits 0 with empty output
            return artifact_success("gitleaks", None, 0, duration_ms)

        count = len(raw) if isinstance(raw, list) else 0
        return artifact_success("gitleaks", raw, count, duration_ms)
    finally:
        try:
            os.remove(report_path)
        except OSError:
            pass


def compress_gitleaks(raw: object) -> list[ScanFinding]:
    if not isinstance(raw, list):
        return []
    findings: list[ScanFinding] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        file = item.get("File", "") or item.get("file", "")
        line = item.get("StartLine", item.get("startLine"))
        severity = SEVERITY_MAP.get(str(item.get("Severity", "Low")), "MEDIUM")
        rule = item.get("RuleID", item.get("rule", "unknown"))
        description = item.get("Description", "") or "Credential-like content detected by gitleaks."
        findings.append(
            ScanFinding(
                id=finding_id("gitleaks", rule, file, line),
                tool="gitleaks",
                severity=severity,
                title=f"Leaked secret detected in {os.path.basename(file) or 'file'}",
                description=description,
                file=file,
                line=line,
                column=None,
                rule=rule,
                category="secrets",
                confidence="HIGH",
                fix=f"Rotate the credential immediately and remove it from source control. "
                     f"Check git history for prior commits containing this secret.",
                cwe=None,
                cvss=None,
                recommendation="Review the match, confirm it is a live credential, rotate it, and scrub history.",
                raw=item,
            )
        )
    return findings