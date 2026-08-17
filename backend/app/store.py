"""In-memory scan registry and event bus.

The backend is a stateless edge agent by design; completed payloads are cached
on the PWA side (IndexedDB). Here we keep enough in-process state for progress
streaming and result retrieval during the active window.
"""
from __future__ import annotations

import asyncio
import itertools
import threading
from datetime import datetime, timezone

from .schemas import ScanReport, StageState

_scan_ids = itertools.count(1)


def new_scan_id() -> str:
    return f"scan-{next(_scan_ids)}"


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def fresh_stages() -> dict[str, StageState]:
    return {
        name: StageState()
        for name in ("scanning", "parsing", "synthesis", "report")
    }


class EventBus:
    """Publish/subscribe channel per scan. Subscribers receive JSON-serializable
    dict events; used by both the WebSocket endpoint and SSE fallback."""

    def __init__(self) -> None:
        self._subs: list[asyncio.Queue[dict]] = []
        self._lock = threading.Lock()

    def publish(self, event: dict) -> None:
        with self._lock:
            subs = list(self._subs)
        for q in subs:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass

    def subscribe(self) -> asyncio.Queue[dict]:
        q: asyncio.Queue[dict] = asyncio.Queue(maxsize=500)
        with self._lock:
            self._subs.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict]) -> None:
        with self._lock:
            if q in self._subs:
                self._subs.remove(q)


class ScanStore:
    def __init__(self) -> None:
        self._reports: dict[str, ScanReport] = {}
        self._buses: dict[str, EventBus] = {}
        self._lock = threading.Lock()

    def create(self, scan_id: str) -> EventBus:
        bus = EventBus()
        report = ScanReport(
            scan_id=scan_id,
            repo_path="",
            status="queued",
            stages=fresh_stages(),
            created_at=utcnow(),
        )
        with self._lock:
            self._reports[scan_id] = report
            self._buses[scan_id] = bus
        return bus

    def get(self, scan_id: str) -> ScanReport | None:
        with self._lock:
            return self._reports.get(scan_id)

    def update(self, report: ScanReport) -> None:
        with self._lock:
            self._reports[report.scan_id] = report

    def list(self) -> list[ScanReport]:
        with self._lock:
            return list(self._reports.values())

    def bus(self, scan_id: str) -> EventBus | None:
        with self._lock:
            return self._buses.get(scan_id)


store = ScanStore()