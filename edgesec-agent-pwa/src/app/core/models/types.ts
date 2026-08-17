import type { ScanRecord } from '../db/db';

/** UAM roles: each renders a different dashboard. */
export type UamRole = 'dev' | 'tester' | 'devsecops' | 'manager';

export const UAM_ROLES: UamRole[] = ['dev', 'tester', 'devsecops', 'manager'];

export interface UamRoleMeta {
  id: UamRole;
  label: string;
  icon: string;
  description: string;
}

export const UAM_ROLE_META: Record<UamRole, UamRoleMeta> = {
  dev: {
    id: 'dev',
    label: 'Developer',
    icon: 'pi pi-code',
    description: 'See vulnerabilities in your code with per-file fixes.',
  },
  tester: {
    id: 'tester',
    label: 'QA Tester',
    icon: 'pi pi-check-square',
    description: 'Verify findings and track remediation status.',
  },
  devsecops: {
    id: 'devsecops',
    label: 'DevSecOps',
    icon: 'pi pi-shield',
    description: 'Monitor scan telemetry, raw outputs and rule tuning.',
  },
  manager: {
    id: 'manager',
    label: 'Manager',
    icon: 'pi pi-chart-bar',
    description: 'Review risk posture, trends and compliance at a glance.',
  },
};

export type ScannerTool = 'gitleaks' | 'trivy' | 'sonarqube';

export const SCANNER_TOOLS: ScannerTool[] = ['gitleaks', 'trivy', 'sonarqube'];

export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export type StageName = 'scanning' | 'parsing' | 'synthesis' | 'report';

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface StageState {
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface ScanFinding {
  id: string;
  tool: ScannerTool | string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  title: string;
  description: string;
  file: string;
  line: number | null;
  column: number | null;
  rule: string;
  category: string;
  confidence: string;
  fix?: string | null;
  cwe?: string | null;
  cvss?: number | null;
  recommendation?: string | null;
  raw?: unknown;
}

export interface ScannerArtifact {
  name: string;
  exitCode: number | null;
  durationMs: number;
  findingsCount: number;
  rawJson: unknown;
  error?: string | null;
  toolVersion?: string | null;
}

export interface LlmTelemetry {
  status: 'ok' | 'degraded' | 'skipped' | 'error';
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs?: number;
  note?: string;
}

export interface ScanMetrics {
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  scannersUsed: ScannerTool[];
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  durationSec: number;
  filesAffected: number;
}

/** Full report the backend returns for a completed scan. */
export interface ScanReportPayload {
  scanId: string;
  repoPath: string;
  status: ScanStatus;
  stages: Record<StageName, StageState>;
  findings: ScanFinding[];
  artifacts: Record<string, ScannerArtifact>;
  llm: LlmTelemetry;
  metrics: ScanMetrics;
  markdownContent: string;
  htmlContent: string;
  createdAt: string;
  error?: string | null;
}

/** Health endpoint response. */
export interface HealthPayload {
  status: 'ok' | 'degraded';
  version: string;
  backend: 'ok';
  scanners: Record<ScannerTool, boolean>;
  llm: { available: boolean; model?: string; endpoint?: string };
  serverTime: string;
}

/** Live progress events streamed over WebSocket/SSE. */
export type ProgressEvent =
  | { type: 'queued'; scanId: string; message?: string }
  | { type: 'stage_started'; stage: StageName; message?: string }
  | { type: 'stage_progress'; stage: StageName; percent: number; detail?: string }
  | { type: 'stage_completed'; stage: StageName; durationMs: number }
  | { type: 'findings_parsed'; count: number }
  | { type: 'llm_started'; model?: string }
  | { type: 'llm_completed'; telemetry: LlmTelemetry }
  | { type: 'scan_completed'; scanId: string }
  | { type: 'scan_failed'; scanId: string; error: string };

export interface ScanEventLogEntry {
  ts: string;
  kind: string;
  message: string;
}

/** Single directory entry from the host folder browser. */
export interface BrowseEntry {
  name: string;
  path: string;
  isDir: boolean;
}

/** Folder browser response; current/parent are absolute host paths. */
export interface BrowseResponse {
  current: string | null;
  parent: string | null;
  entries: BrowseEntry[];
}

/** Local scan row persisted to IndexedDB, enriched with role view. */
export type CachedScan = ScanRecord;

export type FindingStatusOption =
  | 'open'
  | 'verified'
  | 'rejected'
  | 'fixed'
  | 'needs-retest';
