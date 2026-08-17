import { interrupt } from "@langchain/langgraph";
import type { AgentStateType, AgentStateUpdate } from "../state.js";

export interface RemediationProposal {
  candidates: Array<{ id: string; tool: string; ruleId?: string; description: string; filePath: string }>;
}

export function remediationNode() {
  return async (state: AgentStateType): Promise<AgentStateUpdate> => {
    const candidates = state.triage?.remediationCandidates ?? [];
    const proposal: RemediationProposal = {
      candidates: candidates.map((c) => ({
        id: c.id,
        tool: c.tool,
        ruleId: c.ruleId,
        description: c.description,
        filePath: c.filePath,
      })),
    };
    const decision = interrupt({
      kind: "remediation_approval",
      action: "apply_code_fix",
      details: proposal,
    });
    const choice = typeof decision === "string" ? decision.toLowerCase() : "reject";
    return {
      scanTrace: [
        `remediation:candidates=${proposal.candidates.length}`,
        `remediation:decision=${choice}`,
      ],
      messages: [
        {
          role: "user",
          content: choice === "approve" ? "Human decision: Approved remediation." : "Human decision: Rejected remediation.",
        } as any,
      ],
    };
  };
}

export function haltNode() {
  return async (state: AgentStateType): Promise<AgentStateUpdate> => {
    return {
      synthesisComplete: true,
      scanTrace: [`halt:injectionIncidents=${state.triage?.injectionIncidents.length ?? 0}`],
    };
  };
}
