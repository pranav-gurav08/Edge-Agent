import type { AgentStateType } from "../state.js";
import { Send } from "@langchain/langgraph";

export function routeAfterOrchestrator(state: AgentStateType): Array<Send> | string {
  const tools = state.plan?.tools ?? [];
  if (tools.length === 0) return "triage_node";
  return tools.map((t) => new Send(t, { targetDirectory: state.targetDirectory }));
}

export function routeAfterScanners(state: AgentStateType): string {
  if (state.injectionHalt) return "halt";
  return "triage_node";
}

export function routeAfterTriage(state: AgentStateType): string {
  if (state.injectionHalt) return "halt";
  if (state.triage?.remediationCandidates && state.triage.remediationCandidates.length > 0) {
    return "remediation";
  }
  return "report";
}
