"""SonarScanner wrapper.

SonarScanner requires a SonarQube server and a project key. Without a configured
server the tool is reported unavailable rather than producing fake data.
"""

from __future__ import annotations

import asyncio
import json
import os
import urllib.request

from ..config import SONARQUBE_BIN
from ..schemas import ScanFinding, ScannerArtifact
from .base import artifact_error, artifact_success, finding_id, has_binary

SONAR_HOST = os.environ.get("EDGE_SONAR_HOST", "").rstrip("/")
SONAR_TOKEN = os.environ.get("EDGE_SONAR_TOKEN", "")
SONAR_PROJECT_KEY = os.environ.get("EDGE_SONAR_PROJECT_KEY", "")

REPORT_PATH = "n/a"
_JSON_TMP = "reports/sonar-issues.json"


async def run_sonarqube(path: str) -> ScannerArtifact:
    start = asyncio.get_event_loop().time()
    if not has_binary(SONARQUBE_BIN):
        return artifact_error("sonarqube", "sonar-scanner binary not found on PATH")
    if not SONAR_HOST or not SONAR_PROJECT_KEY:
        return artifact_error("sonarqube", "EDGE_SONAR_HOST / EDGE_SONAR_PROJECT_KEY not configured")

    # sonar-scanner writes to sonar-project.properties in the target; we generate a
    # minimal one so the run is self-contained.
    from .base import resolve_target

    target = resolve_target(path)
    props = os.path.join(target, "sonar-project.properties")
    try:
        with open(props, "w", encoding="utf-8") as fh:
            fh.write(f"sonar.projectKey={SONAR_PROJECT_KEY}\n")
            fh.write(f"sonar.sources={target}\n")
            fh.write("sonar.sourceEncoding=UTF-8\n")
    except OSError as exc:
        return artifact_error("sonarqube", f"cannot write sonar-project.properties: {exc}")

    try:
        import asyncio as aio

        from .base import run_binary

        args = [
            "-Dsonar.host.url=" + SONAR_HOST,
            "-Dsonar.login=" + (SONAR_TOKEN or ""),
            "-Dsonar.projectBaseDir=" + target,
            f"-Dsonar.projectKey={SONAR_PROJECT_KEY}",
            "-Dsonar.branch.name=main",
        ]
        out, code = await run_binary(SONARQUBE_BIN, args)
        duration_ms = int((aio.get_event_loop().time() - start) * 1000)
        if code != 0:
            return artifact_error("sonarqube", f"sonar-scanner exited with code {code}", duration_ms)

        issues = await _fetch_issues(SONAR_HOST, SONAR_PROJECT_KEY, SONAR_TOKEN)
        raw: object = {"issues": issues}
        return artifact_success("sonarqube", raw, len(issues), duration_ms)
    finally:
        try:
            os.remove(props)
        except OSError:
            pass


async def _fetch_issues(host: str, project_key: str, token: str) -> list[dict]:
    def _do() -> list[dict]:
        url = f"{host}/api/issues/search?componentKeys={project_key}&ps=100&severities=CRITICAL,HIGH,MAJOR,MINOR,INFO"
        req = urllib.request.Request(url)
        if token:
            import base64

            raw = f"{token}:".encode()
            req.add_header("Authorization", "Basic " + base64.b64encode(raw).decode())
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return data.get("issues", [])
        except Exception:
            return []

    return await asyncio.to_thread(_do)


def compress_sonarqube(raw: object) -> list[ScanFinding]:
    findings: list[ScanFinding] = []
    if not isinstance(raw, dict):
        return findings
    for item in raw.get("issues") or []:
        if not isinstance(item, dict):
            continue
        severity = str(item.get("severity", "MINOR")).upper()
        if severity not in ("CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"):
            severity = "MEDIUM"
        rule = str(item.get("rule", "unknown"))
        file = str(item.get("component", "") or "").split(":")[-1]
        text_range = item.get("textRange") or {}
        findings.append(
            ScanFinding(
                id=finding_id("sonarqube", rule, file, text_range.get("startLine")),
                tool="sonarqube",
                severity=severity,
                title=item.get("message", "") or rule,
                description=item.get("message", "") or "Issue reported by SonarQube.",
                file=file,
                line=text_range.get("startLine"),
                column=text_range.get("startColumn"),
                rule=rule,
                category="code-quality",
                confidence="HIGH",
                fix=None,
                cwe=None,
                cvss=None,
                recommendation="Open the issue in the SonarQube UI for remediation guidance.",
                raw=item,
            )
        )
    return findings