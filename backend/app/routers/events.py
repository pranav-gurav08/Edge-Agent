"""Real-time progress delivery: WebSocket + SSE.

The WebSocket lives at /ws/scan/{id} (same origin, primed by the PWA). The SSE
fallback route /api/v1/scan-events/{id} lives in the API sub-app (scan router).
"""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ..store import store

router = APIRouter(tags=["events"])

TERMINAL = {"scan_completed", "scan_failed"}


@router.websocket("/ws/scan/{scan_id}")
async def ws_scan(websocket: WebSocket, scan_id: str) -> None:
    report = store.get(scan_id)
    if report is None:
        await websocket.close(code=4404)
        return
    await websocket.accept()
    bus = store.bus(scan_id)
    if bus is None:
        await websocket.close(code=1011)
        return
    queue = bus.subscribe()
    try:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=20)
                await websocket.send_text(json.dumps(event))
                if event.get("type") in TERMINAL:
                    break
            except asyncio.TimeoutError:
                await websocket.send_text(json.dumps({"type": "heartbeat"}))
            except (WebSocketDisconnect, RuntimeError):
                break
    finally:
        bus.unsubscribe(queue)