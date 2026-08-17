"""Trivy scanner wrapper (vulnerabilities + misconfigurations)."""

from __future__ import annotations

import asyncio
import os

from ..config import TRIVY_BIN
from ..schemas import ScanFinding, ScannerArtifact
from .base import artifact_error, artifact_success, finding_id, has_binary, parse_json_output, resolve_target, run_binary

SEVERITY_MAP = {
    "CRITICAL": "CRITICAL",
    "HIGH": "HIGH",
    "MEDIUM": "MEDIUM",
    "LOW": "LOW",
    "LOWSEVERITY": "LOW",
}

# Skip the vulnerability-db download (first run can take minutes) when a warm
# trivy cache already exists on the host.
SKIP_UPDATE = os.environ.get("EDGE_TRIVY_SKIP_UPDATE", "0") == "1"


async def run_trivy(path: str) -> ScannerArtifact:
    start = asyncio.get_event_loop().time()
    if not has_binary(TRIVY_BIN):
        return artifact_error("trivy", "trivy binary not found on PATH")

    target = resolve_target(path)
    # `fs` mode scans a filesystem/directory; include secrets + misconfiguration.
    args = [
        "fs",
        "--format", "json",
        "--scanners", "vuln,misconfig,secret",
        "--no-progress",
        "--exit-code", "0",
        "--severity", "CRITICAL,HIGH,MEDIUM,LOW",
    ]
    if SKIP_UPDATE:
        args += ["--skip-db-update", "--skip-policy-update"]
    args.append(target)
    out, code = await run_binary(TRIVY_BIN, args)
    duration_ms = int((asyncio.get_event_loop().time() - start) * 1000)

    if code != 0 and not out:
        return artifact_error("trivy", f"trivy exited with code {code}", duration_ms)

    raw = parse_json_output(out)
    if raw is None:
        return artifact_success("trivy", None, 0, duration_ms)

    count = 0
    if isinstance(raw, dict):
        results = raw.get("Results") or []
        for r in results:
            if isinstance(r, dict):
                count += len(r.get("Vulnerabilities") or []) + len(r.get("Misconfigurations") or []) + len(r.get("Secrets") or [])
    return artifact_success("trivy", raw, count, duration_ms)


def compress_trivy(raw: object) -> list[ScanFinding]:
    findings: list[ScanFinding] = []
    if not isinstance(raw, dict):
        return findings

    for result in raw.get("Results") or []:
        if not isinstance(result, dict):
            continue
        file = result.get("Target", "") or ""
        klass = result.get("Class", "")

        for item in result.get("Vulnerabilities") or []:
            if not isinstance(item, dict):
                continue
            vuln_id = str(item.get("VulnerabilityID", "unknown"))
            sev = SEVERITY_MAP.get(str(item.get("Severity", "MEDIUM")), "MEDIUM")
            findings.append(
                ScanFinding(
                    id=finding_id("trivy", vuln_id, file, item.get("PkgName")),
                    tool="trivy",
                    severity=sev,
                    title=f"{vuln_id} in {item.get('PkgName', '?')}",
                    description=item.get("Description", "") or f"Vulnerable package detected ({vuln_id}).",
                    file=file,
                    line=None,
                    column=None,
                    rule=vuln_id,
                    category="vulnerability",
                    confidence="HIGH",
                    fix=item.get("FixedVersion")
                    and f"Upgrade {item.get('PkgName')} to {item.get('FixedVersion')} or later."
                    or "No fixed version published yet.",
                    cwe=None,
                    cvss=item.get("CVSS", {}).get("nvd", {}).get("V3Score")
                    if isinstance(item.get("CVSS"), dict)
                    else None,
                    recommendation="Apply distributor/upstream patches; position the package update in the next release.",
                    raw=item,
                )
            )

        for item in result.get("Misconfigurations") or []:
            if not isinstance(item, dict):
                continue
            mis_id = str(item.get("ID", "misconfig"))
            sev = SEVERITY_MAP.get(str(item.get("Severity", "MEDIUM")), "MEDIUM")
            findings.append(
                ScanFinding(
                    id=finding_id("trivy", mis_id, file, None),
                    tool="trivy",
                    severity=sev,
                    title=f"Misconfiguration: {item.get('Title', mis_id)}",
                    description=item.get("Message", "") or "Infrastructure-as-Code misconfiguration flagged by trivy.",
                    file=file,
                    line=None,
                    column=None,
                    rule=mis_id,
                    category="misconfiguration",
                    confidence="MEDIUM",
                    fix=item.get("Resolution", None),
                    cwe=item.get("References", [None])[0] if isinstance(item.get("References"), list) else None,
                    cvss=None,
                    recommendation="Apply the stated resolution and re-run IaC validation in CI.",
                    raw=item,
                )
            )

        for item in result.get("Secrets") or []:
            if not isinstance(item, dict):
                continue
            rule = str(item.get("RuleID", "secret"))
            sev = SEVERITY_MAP.get(str(item.get("Severity", "LOW")), "LOW")
            findings.append(
                ScanFinding(
                    id=finding_id("trivy", rule, file, item.get("StartLine")),
                    tool="trivy",
                    severity=sev,
                    title=f"Secret found: {rule}",
                    description=item.get("Title", "") or "Secret-like content detected by trivy.",
                    file=file,
                    line=item.get("StartLine"),
                    column=None,
                    rule=rule,
                    category="secrets",
                    confidence="HIGH",
                    fix="Rotate the secret and remove it from the scanned artifact.",
                    cwe=None,
                    cvss=None,
                    recommendation="Treat as high priority; rotate and scrub from history.",
                    raw=item,
                )
            )
    return findings