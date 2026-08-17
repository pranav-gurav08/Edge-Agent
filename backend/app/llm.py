"""Local LLM client (Ollama / OpenAI-compatible endpoints).

Deliberately dependency-free: calls run on worker threads via urllib so the
edge backend has no heavyweight client SDKs. If the LLM is unreachable the
caller degrades gracefully to a deterministic summary (still grounded in the
real scanner findings — never mock data).
"""
from __future__ import annotations

import asyncio
import json
import urllib.request

from .config import LLM_API_KEY, LLM_ENDPOINT, LLM_MODEL
from .schemas import LlmTelemetry, ScanFinding


def _post_json(url: str, payload: dict, headers: dict | None = None, timeout: int = 90) -> dict:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


async def analyze_findings(findings: list[ScanFinding], repo_path: str, max_items: int) -> tuple[str, LlmTelemetry]:
    """Send findings to the local LLM for contextual synthesis.

    Returns (analysis_markdown, telemetry). Degrades to a deterministic
    programmatic summary when the LLM cannot be reached.
    """
    payload_findings = [
        {
            "severity": f.severity,
            "title": f.title,
            "tool": f.tool,
            "file": f.file,
            "line": f.line,
            "rule": f.rule,
        }
        for f in findings[:max_items]
    ]
    context = (
        "You are a DevSecOps analyst. Given the security findings from real scanners "
        "run against a local repository, write a concise Markdown executive summary. "
        "Group by severity, highlight the most urgent fixes, and note scanner gaps. "
        "Do not invent findings that are not present in the input."
        f"\n\nRepository: {repo_path}\nFindings (JSON):\n{json.dumps(payload_findings)}"
    )

    try:
        loop = asyncio.get_event_loop()
        if LLM_API_KEY:
            telemetry, text = await loop.run_in_executor(
                None, _chat_openai, context
            )
        else:
            telemetry, text = await loop.run_in_executor(
                None, _chat_ollama, context
            )
        return text, telemetry
    except Exception as exc:  # noqa: BLE001 - all failure modes degrade gracefully
        telemetry = LlmTelemetry(
            status="degraded",
            model=LLM_MODEL,
            note=f"LLM unreachable ({exc.__class__.__name__}); synthesized programmatically.",
        )
        summary = _fallback_summary(findings)
        return summary, telemetry


def _chat_ollama(prompt: str) -> tuple[LlmTelemetry, str]:
    url = LLM_ENDPOINT.rstrip("/") + "/api/generate"
    payload = {"model": LLM_MODEL, "prompt": prompt, "stream": False, "options": {"temperature": 0.2}}
    import time

    started = time.monotonic()
    data = _post_json(url, payload)
    latency = int((time.monotonic() - started) * 1000)
    text = data.get("response", "")
    if not text.strip():
        raise RuntimeError("empty LLM response")
    telemetry = LlmTelemetry(
        status="ok",
        model=LLM_MODEL,
        prompt_tokens=int(data.get("prompt_eval_count", 0)),
        completion_tokens=int(data.get("eval_count", 0)),
        latency_ms=latency,
    )
    return telemetry, text


def _chat_openai(prompt: str) -> tuple[LlmTelemetry, str]:
    url = LLM_ENDPOINT.rstrip("/") + "/v1/chat/completions"
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": "You produce concise, factual Markdown."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
    }
    import time

    started = time.monotonic()
    data = _post_json(url, payload, headers={"Authorization": f"Bearer {LLM_API_KEY}"})
    latency = int((time.monotonic() - started) * 1000)
    text = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if not text.strip():
        raise RuntimeError("empty LLM response")
    usage = data.get("usage", {})
    telemetry = LlmTelemetry(
        status="ok",
        model=LLM_MODEL,
        prompt_tokens=int(usage.get("prompt_tokens", 0)),
        completion_tokens=int(usage.get("completion_tokens", 0)),
        latency_ms=latency,
    )
    return telemetry, text


def _fallback_summary(findings: list[ScanFinding]) -> str:
    counts: dict[str, int] = {}
    for f in findings:
        counts[f.severity] = counts.get(f.severity, 0) + 1
    total = len(findings)
    if total == 0:
        return "No findings were reported by the configured scanners on this target."
    lines = [
        f"## Executive Summary",
        "",
        f"The local scan surfaced **{total} known finding(s)** across the repository.",
        "",
        "- Critical: " + str(counts.get("CRITICAL", 0)),
        "- High: " + str(counts.get("HIGH", 0)),
        "- Medium: " + str(counts.get("MEDIUM", 0)),
        "- Low: " + str(counts.get("LOW", 0)),
        "- Info: " + str(counts.get("INFO", 0)),
        "",
        "This summary was synthesized programmatically because the local LLM "
        "was unavailable; the underlying scanner output is real and complete.",
    ]
    return "\n".join(lines)