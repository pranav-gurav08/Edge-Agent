import Dexie, { type Table } from 'dexie';
import type { ScanMetrics, ScanStatus } from '../models/types';

/**
 * A completed scan persisted locally so reports stay available offline.
 * `markdownContent`/`htmlContent` are the rendered report artifacts.
 */
export interface ScanRecord {
  id?: number;
  scanId: string;
  repoPath: string;
  timestamp: string;
  status: ScanStatus;
  roleView: string;
  markdownContent: string;
  htmlContent: string;
  metrics: ScanMetrics;
  findingsJson: string;
  artifactsJson: string;
  llmJson: string;
  createdAt: string;
}

/** Verification decisions made by the QA tester role (persisted locally). */
export interface VerificationRecord {
  id?: number;
  findingId: string;
  scanId: string;
  decision: 'open' | 'verified' | 'rejected' | 'fixed' | 'needs-retest';
  note: string;
  updatedAt: string;
}

/** Per-tool settings and backend connection configuration. */
export interface SettingsRecord {
  id?: number;
  key: string;
  value: unknown;
  updatedAt: string;
}

/** User session: active role + theme preference. */
export interface SessionRecord {
  id?: number;
  currentRole: string;
  theme: 'dark' | 'light';
  updatedAt: string;
}

class EdgeSecDatabase extends Dexie {
  scans!: Table<ScanRecord>;
  verifications!: Table<VerificationRecord>;
  settings!: Table<SettingsRecord>;
  session!: Table<SessionRecord>;

  constructor() {
    super('edgesec-agent-db');
    this.version(1).stores({
      scans: '++id, &scanId, repoPath, status, timestamp',
      verifications: '++id, findingId, scanId',
      settings: '&key',
      session: '++id',
    });
  }
}

export const db = new EdgeSecDatabase();
