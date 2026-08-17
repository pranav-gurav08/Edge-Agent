"""Shared helpers for running scanner binaries safely.

Scanner tools are invoked only through fixed binary names with argument arrays
(no string interpolation, no shell). Timeouts and output-size caps keep the edge
agent bounded. If a binary is missing or fails, the caller records an error in
the artifact instead of failing the whole scan.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import uuid

from ..config import SCAN_TIMEOUT_SEC
from ..schemas import ScannerArtifact

MAX_OUTPUT_BYTES = 8 * 1024 * 1024


def resolve_target(path: str) -> str:
    """Validate + canonicalize an absolute repo/file path supplied by the user."""
    if len(path) > 4096:
        raise ValueError("repo_path is too long")
    expanded = os.path.abspath(os.path.expanduser(path))
    if not os.path.exists(expanded):
        raise ValueError(f"path does not exist: {path}")
    return expanded


def has_binary(name: str) -> bool:
    return shutil.which(name) is not None


async def run_binary(binary: str, args: list[str], timeout: int | None = None) -> tuple[str, int]:
    """Execute `binary args` and return (stdout, exit_code). Binary must be a
    bare executable name resolved via PATH — never a caller-supplied path."""
    if os.sep in binary or (os.altsep and os.altsep in binary):
        raise ValueError("scanner binary must be a plain executable name")
    proc = await asyncio.create_subprocess_exec(
        binary,
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout or SCAN_TIMEOUT_SEC)
    except asyncio.TimeoutError:
        proc.kill()
        return "", 124
    text = (out or b"").decode("utf-8", errors="replace")[:MAX_OUTPUT_BYTES]
    return text, proc.returncode or 0


def parse_json_output(text: str) -> object | None:
    """Best-effort parse of scanner JSON output; returns None on malformed data."""
    if not text.strip():
        return None
    stripped = text.lstrip("\ufeff \t\r\n")
    # If the payload already begins with a JSON array/object, parse it directly.
    # (The banner-strip below would otherwise corrupt a trailing "]".)
    if stripped.startswith("[") or stripped.startswith("{"):
        text = stripped
    else:
        # Trivy/Gitleaks can emit a leading banner line on stderr that got merged.
        idx = stripped.find("{")
        if idx != -1:
            text = stripped[idx:]
    try:
        import json

        data = json.loads(text)
        return data if isinstance(data, list | dict) else None
    except Exception:
        return None


def finding_id(tool: str, rule: str, file: str, line: int | str | None) -> str:
    raw = f"{tool}:{rule}:{file}:{line}".encode("utf-8", errors="ignore")
    return str(uuid.uuid5(uuid.NAMESPACE_URL, raw.decode("utf-8", errors="ignore") + str(uuid.uuid4())[:6]))


def artifact_success(name: str, raw: object, findings_count: int, duration_ms: int, version: str | None = None) -> ScannerArtifact:
    return ScannerArtifact(
        name=name,
        exit_code=0,
        duration_ms=duration_ms,
        findings_count=findings_count,
        raw_json=raw,
        tool_version=version,
    )


def artifact_error(name: str, message: str, duration_ms: int = 0) -> ScannerArtifact:
    return ScannerArtifact(name=name, duration_ms=duration_ms, raw_json=None, error=message, exit_code=None)