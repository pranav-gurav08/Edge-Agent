"""Scanner dispatch registry used by the graph's scanning node."""
from __future__ import annotations

from ..schemas import ScanFinding
from .gitleaks import compress_gitleaks, run_gitleaks
from .sonarqube import compress_sonarqube, run_sonarqube
from .trivy import compress_trivy, run_trivy

RUNNERS = {
    "gitleaks": run_gitleaks,
    "trivy": run_trivy,
    "sonarqube": run_sonarqube,
}

COMPRESSORS = {
    "gitleaks": compress_gitleaks,
    "trivy": compress_trivy,
    "sonarqube": compress_sonarqube,
}


def dedupe_findings(findings: list[ScanFinding]) -> list[ScanFinding]:
    """Collapse exact duplicates (same tool + rule + file + line)."""
    seen: dict[tuple, ScanFinding] = {}
    for f in findings:
        key = (f.tool, f.rule, f.file, f.line)
        if key not in seen:
            seen[key] = f
    return list(seen.values())