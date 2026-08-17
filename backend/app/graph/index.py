"""Compile the LangGraph workflow for the scan pipeline."""
from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from ..store import EventBus
from .nodes import node_parse, node_report, node_scan, node_synthesize
from .state import AgentState


def build_agent(bus: EventBus):
    """Compile a StateGraph running scanning → parsing → synthesis → report.

    The event bus is closed over by node wrappers (signature `(state, bus)`) so
    progress events flow to WebSocket/SSE subscribers during the run.
    """

    def bind(fn):
        async def wrapped(state: dict) -> dict:
            return await fn(state, bus)

        return wrapped

    g = StateGraph(AgentState)
    g.add_node("scan", bind(node_scan))
    g.add_node("parse", bind(node_parse))
    g.add_node("synthesize", bind(node_synthesize))
    g.add_node("report", bind(node_report))
    g.add_edge(START, "scan")
    g.add_edge("scan", "parse")
    g.add_edge("parse", "synthesize")
    g.add_edge("synthesize", "report")
    g.add_edge("report", END)
    return g.compile()