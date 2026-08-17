import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import type { BaseMessage } from "@langchain/core/messages";

export type ToolName = "gitleaks" | "trivy" | "sonarqube";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export interface SecurityFinding {
  id: string;
  tool: ToolName;
  severity: Severity;
  description: string;
  filePath: string;
  ruleId?: string;
  line?: number;
  count?: number;
  falsePositive?: boolean;
  rationale?: string;
}

export interface ScanPlan {
  tools: ToolName[];
  rationale: string;
  languageHints: string[];
  iac: boolean;
  hasGit: boolean;
}

export interface WikiHit {
  entitySlug: string;
  content: string;
  similarity: number;
}

export interface InjectionIncident {
  filePath: string;
  pattern: string;
  severity: Severity;
  description: string;
}

export interface TriageOutput {
  report: string;
  falsePositives: string[];
  injectionIncidents: InjectionIncident[];
  remediationCandidates: SecurityFinding[];
  wikiContext: WikiHit[];
}

const last = <T>(x: T, y: T): T => (y === undefined || y === null ? x : y);

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  targetDirectory: Annotation<string>({
    reducer: last,
    default: () => "",
  }),
  rawFindings: Annotation<SecurityFinding[]>({
    reducer: (existing, next) => existing.concat(next ?? []),
    default: () => [],
  }),
  plan: Annotation<ScanPlan | null>({
    reducer: last,
    default: () => null,
  }),
  triage: Annotation<TriageOutput | null>({
    reducer: last,
    default: () => null,
  }),
  wikiContext: Annotation<WikiHit[]>({
    reducer: (existing, next) => existing.concat(next ?? []),
    default: () => [],
  }),
  synthesisComplete: Annotation<boolean>({
    reducer: last,
    default: () => false,
  }),
  finalReportPath: Annotation<string>({
    reducer: last,
    default: () => "",
  }),
  injectionHalt: Annotation<boolean>({
    reducer: last,
    default: () => false,
  }),
  scanTrace: Annotation<string[]>({
    reducer: (existing, next) => existing.concat(next ?? []),
    default: () => [],
  }),
});

export type AgentStateType = typeof AgentState.State;
export type AgentStateUpdate = typeof AgentState.Update;
