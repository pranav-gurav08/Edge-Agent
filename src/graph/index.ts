import { StateGraph, START, END } from "@langchain/langgraph";
import { AgentState } from "../state.js";
import { orchestratorNode, gitleaksNode, trivyNode, sonarqubeNode, triageNode } from "./nodes.js";
import { routeAfterOrchestrator, routeAfterTriage } from "./edges.js";
import { remediationNode, haltNode } from "./remediation.js";
import { reportNode, type ReportDeps } from "./report.js";
import type { LocalLLM } from "../llm.js";
import type { MemoryStore } from "../db/pglite.js";
import type { Embedder } from "../embeddings.js";

export interface GraphDeps {
  llm: LocalLLM;
  embedder: Embedder;
  store?: MemoryStore;
  reportDir: string;
}

export interface CompiledAgent {
  app: ReturnType<ReturnType<typeof buildGraph>["compile"]>;
  deps: GraphDeps;
}

export function buildGraph(deps: GraphDeps) {
  const nodeDeps = { llm: deps.llm, store: deps.store, embedder: deps.embedder };
  const reportDeps: ReportDeps = { reportDir: deps.reportDir, store: deps.store, embedder: deps.embedder };

  const g = new StateGraph(AgentState)
    .addNode("orchestrator", orchestratorNode(nodeDeps))
    .addNode("gitleaks", gitleaksNode(nodeDeps))
    .addNode("trivy", trivyNode(nodeDeps))
    .addNode("sonarqube", sonarqubeNode(nodeDeps))
    .addNode("triage_node", triageNode(nodeDeps))
    .addNode("remediation", remediationNode())
    .addNode("halt", haltNode())
    .addNode("report", reportNode(reportDeps))
    .addEdge(START, "orchestrator")
    .addConditionalEdges("orchestrator", routeAfterOrchestrator, {
      gitleaks: "gitleaks",
      trivy: "trivy",
      sonarqube: "sonarqube",
      triage_node: "triage_node",
    })
    .addEdge("gitleaks", "triage_node")
    .addEdge("trivy", "triage_node")
    .addEdge("sonarqube", "triage_node")
    .addConditionalEdges("triage_node", routeAfterTriage, {
      remediation: "remediation",
      report: "report",
      halt: "halt",
    })
    .addEdge("remediation", "report")
    .addEdge("halt", END)
    .addEdge("report", END);

  return g;
}

import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

export function compileAgent(deps: GraphDeps, checkpointer?: BaseCheckpointSaver) {
  const g = buildGraph(deps);
  return checkpointer ? g.compile({ checkpointer }) : g.compile();
}
