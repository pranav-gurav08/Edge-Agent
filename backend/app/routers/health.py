"""GET /api/v1/health — backend + scanner + LLM availability probe."""
from __future__ import annotations

import asyncio
import socket
from urllib.parse import urlparse

from fastapi import APIRouter

from ..config import LLM_ENDPOINT, LLM_MODEL, VERSION
from ..schemas import HealthPayload, ScannerTool
from ..scanners.base import has_binary
from ..scanners.gitleaks import GITLEAKS_BIN
from ..scanners.trivy import TRIVY_BIN
from ..scanners.sonarqube import SONARQUBE_BIN
from ..store import utcnow

router = APIRouter(tags=["health"])


async def _llm_reachable() -> bool:
    parsed = urlparse(LLM_ENDPOINT)
    host = parsed.hostname or "localhost"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=1.5
        )
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except Exception:
        return False


@router.get("/health", response_model=HealthPayload)
async def health() -> HealthPayload:
    scanners: dict[ScannerTool, bool] = {
        "gitleaks": has_binary(GITLEAKS_BIN),
        "trivy": has_binary(TRIVY_BIN),
        "sonarqube": has_binary(SONARQUBE_BIN),
    }
    llm_ok = await _llm_reachable()
    status = "ok" if any(scanners.values()) else "degraded"
    return HealthPayload(
        status=status,
        version=VERSION,
        scanners=scanners,
        llm={
            "available": llm_ok,
            "model": LLM_MODEL if llm_ok else None,
            "endpoint": LLM_ENDPOINT if llm_ok else None,
        },
        server_time=utcnow(),
    )