import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { db, type ScanRecord } from '../db/db';
import { ApiService } from './api.service';
import { WebSocketService } from './websocket.service';
import type {
  ProgressEvent,
  ScanMetrics,
  ScanReportPayload,
  ScannerArtifact,
  ScannerTool,
  ScanFinding,
  StageName,
  StageState,
} from '../models/types';

/**
 * Owns the scan lifecycle: starts a scan on the backend, streams progress via
 * the WebSocket/SSE channel, persists the completed report to IndexedDB, and
 * falls back to cached reports when the backend is unreachable.
 */
@Injectable({ providedIn: 'root' })
export class ScanService {
  private readonly api = inject(ApiService);
  private readonly ws = inject(WebSocketService);

  /** Reports cached locally in IndexedDB (survive offline). */
  readonly cachedScans = signal<ScanRecord[]>([]);

  /** Currently active/loaded scan record (from cache or live). */
  readonly activeScan = signal<ScanRecord | null>(null);

  /** Fine-grained stage state for the progress stepper. */
  readonly stages = signal<Record<StageName, StageState>>({
    scanning: { status: 'pending' },
    parsing: { status: 'pending' },
    synthesis: { status: 'pending' },
    report: { status: 'pending' },
  });

  readonly isScanning = signal(false);
  readonly scanError = signal<string | null>(null);
  readonly backendOnline = signal(true);

  /** Rolled-up metrics for the active scan (updated live during a run). */
  readonly liveMetrics = signal<ScanMetrics | null>(null);
  readonly liveFindings = signal<ScanFinding[]>([]);
  readonly liveArtifacts = signal<Record<string, ScannerArtifact>>({});

  private initialized = false;

  constructor() {
    void this.loadCachedScans();
  }

  /** Load all persisted reports from IndexedDB. */
  async loadCachedScans(): Promise<void> {
    try {
      const rows = await db.scans.orderBy('timestamp').reverse().toArray();
      this.cachedScans.set(rows);
    } catch (e) {
      console.warn('[scan] failed to read IndexedDB', e);
    }
  }

  /** Show a previously cached report (offline-safe). */
  async selectCached(scanId: string): Promise<void> {
    const row = await db.scans.get({ scanId });
    if (!row) return;
    this.activeScan.set(row);
    this.hydrateFromRow(row);
  }

  async startScan(repoPath: string, tools: ScannerTool[]): Promise<void> {
    this.resetForRun();
    this.scanError.set(null);
    this.isScanning.set(true);
    this.backendOnline.set(true);

    try {
      const { scanId } = await firstValueFrom(
        this.api.startScan({ repoPath, tools }),
      );
      this.ws.connect(scanId);
      this.ws.onEvent((evt) => this.handleProgress(evt));

      const payload = await this.waitForCompletion(scanId);
      await this.persist(payload);
    } catch (err) {
      this.isScanning.set(false);
      this.backendOnline.set(false);
      const msg = err instanceof Error ? err.message : 'Scan failed';
      this.scanError.set(`${msg} — falling back to cached reports.`);
      await this.loadCachedScans();
    }
  }

  /** Pull the finished report once WS reports completion, with a poll timeout. */
  private async waitForCompletion(scanId: string): Promise<ScanReportPayload> {
    const started = Date.now();
    return new Promise<ScanReportPayload>((resolve, reject) => {
      const poll = async () => {
        try {
          const payload = await firstValueFrom(this.api.getScanResult(scanId));
          if (payload.status === 'completed' || payload.status === 'failed') {
            this.isScanning.set(false);
            if (payload.status === 'failed') {
              this.scanError.set(payload.error ?? 'Scan failed on backend');
            }
            resolve(payload);
            return;
          }
        } catch {
          /* transient network error — keep polling */
        }
        if (Date.now() - started > 600_000) {
          this.isScanning.set(false);
          reject(new Error('Timed out waiting for scan result'));
          return;
        }
        setTimeout(poll, 1200);
      };
      void poll();
    });
  }

  private handleProgress(evt: ProgressEvent): void {
    switch (evt.type) {
      case 'stage_started':
        this.setStage(evt.stage, { status: 'running', startedAt: new Date().toISOString() });
        break;
      case 'stage_progress':
        this.updateStage(evt.stage, { status: 'running' });
        break;
      case 'stage_completed':
        this.updateStage(evt.stage, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          durationMs: evt.durationMs,
        });
        break;
      case 'findings_parsed':
        this.updateStage('parsing', { status: 'completed' });
        break;
      case 'llm_completed':
        this.updateStage('synthesis', { status: 'completed' });
        break;
      case 'scan_completed':
        this.updateStage('report', { status: 'completed' });
        break;
      case 'scan_failed':
        this.isScanning.set(false);
        this.scanError.set(evt.error);
        this.updateStage('scanning', { status: 'failed' });
        break;
    }
  }

  private setStage(stage: StageName, state: StageState): void {
    this.stages.update((s) => ({ ...s, [stage]: { ...s[stage], ...state } }));
  }

  private updateStage(stage: StageName, patch: Partial<StageState>): void {
    this.stages.update((s) => ({ ...s, [stage]: { ...s[stage], ...patch } }));
  }

  private resetForRun(): void {
    this.stages.set({
      scanning: { status: 'running', startedAt: new Date().toISOString() },
      parsing: { status: 'pending' },
      synthesis: { status: 'pending' },
      report: { status: 'pending' },
    });
    this.liveFindings.set([]);
    this.liveArtifacts.set({});
    this.liveMetrics.set(null);
  }

  private async persist(payload: ScanReportPayload): Promise<void> {
    const row: ScanRecord = {
      scanId: payload.scanId,
      repoPath: payload.repoPath,
      timestamp: payload.createdAt,
      status: payload.status,
      roleView: 'all',
      markdownContent: payload.markdownContent,
      htmlContent: payload.htmlContent,
      metrics: payload.metrics,
      findingsJson: JSON.stringify(payload.findings),
      artifactsJson: JSON.stringify(payload.artifacts),
      llmJson: JSON.stringify(payload.llm),
      createdAt: payload.createdAt,
    };
    await db.scans.put(row);
    this.activeScan.set(row);
    this.hydrateFromRow(row);
    await this.loadCachedScans();
  }

  private hydrateFromRow(row: ScanRecord): void {
    try {
      const findings = JSON.parse(row.findingsJson) as ScanFinding[];
      const artifacts = JSON.parse(row.artifactsJson) as Record<string, ScannerArtifact>;
      this.liveFindings.set(findings);
      this.liveArtifacts.set(artifacts);
      this.liveMetrics.set(row.metrics);
      this.stages.set({
        scanning: { status: 'completed' },
        parsing: { status: 'completed' },
        synthesis: { status: 'completed' },
        report: { status: 'completed' },
      });
    } catch (e) {
      console.warn('[scan] hydrate failed', e);
    }
  }
}
