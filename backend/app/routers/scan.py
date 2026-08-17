"""Scan lifecycle routes: start a scan, list scans, fetch results, SSE stream."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..graph.index import build_agent
from ..schemas import ScanReport, ScanRequest, ScanStarted
from ..scanners.base import resolve_target
from ..store import new_scan_id, store

router = APIRouter(tags=["scan"])

TERMINAL = {"scan_completed", "scan_failed"}


async def _run_workflow(scan_id: str, repo_path: str, tools: list[str]) -> None:
    bus = store.bus(scan_id)
    report = store.get(scan_id)
    if bus is None or report is None:
        return
    report.repo_path = repo_path
    report.status = "running"
    store.update(report)
    bus.publish({"type": "queued", "scanId": scan_id})

    graph = build_agent(bus)
    try:
        initial = {
            "scan_id": scan_id,
            "repo_path": repo_path,
            "tools": tools,
            "report": report,
            "findings": [],
        }
        # ainvoke returns final state; the report object is mutated in place.
        await graph.ainvoke(initial)
    except Exception as exc:  # noqa: BLE001 - surface failure to the UI
        report.status = "failed"
        report.error = str(exc)
        store.update(report)
        bus.publish({"type": "scan_failed", "scanId": scan_id, "error": str(exc)})


@router.post("/scan", response_model=ScanStarted)
async def start_scan(req: ScanRequest) -> ScanStarted:
    try:
        resolve_target(req.repo_path)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    scan_id = new_scan_id()
    bus = store.create(scan_id)
    report = store.get(scan_id)
    if report is not None:
        report.repo_path = req.repo_path
        report.stages = report.stages  # fresh stages already in place
        store.update(report)
    bus.publish({"type": "queued", "scanId": scan_id})

    asyncio.create_task(_run_workflow(scan_id, req.repo_path, list(req.tools)))
    return ScanStarted(scan_id=scan_id)


@router.get("/scan-results/{scan_id}", response_model=ScanReport)
async def get_scan_result(scan_id: str) -> ScanReport:
    report = store.get(scan_id)
    if report is None:
        raise HTTPException(status_code=404, detail="scan not found")
    return report


@router.get("/scans", response_model=list[dict])
async def list_scans() -> list[dict]:
    out = []
    for report in sorted(store.list(), key=lambda r: r.created_at, reverse=True):
        m = report.metrics
        out.append(
            {
                "scanId": report.scan_id,
                "repoPath": report.repo_path,
                "status": report.status,
                "createdAt": report.created_at,
                "metricsSummary": {
                    "totalFindings": m.total_findings,
                    "criticalCount": m.critical_count,
                    "riskScore": m.risk_score,
                },
            }
        )
    return out


@router.get("/scan-events/{scan_id}")
async def sse_scan(scan_id: str):
    report = store.get(scan_id)
    if report is None:
        raise HTTPException(status_code=404, detail="scan not found")
    bus = store.bus(scan_id)
    if bus is None:
        raise HTTPException(status_code=404, detail="scan not found")

    queue = bus.subscribe()

    async def gen():
        try:
            yield "retry: 3000\n\n"
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                    yield f"data: {json.dumps(event)}\n\n"
                    if event.get("type") in TERMINAL:
                        break
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            bus.unsubscribe(queue)

    return StreamingResponse(gen(), media_type="text/event-stream")