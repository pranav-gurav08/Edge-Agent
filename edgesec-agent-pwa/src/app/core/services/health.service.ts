import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './api.service';
import type { HealthPayload, ScannerTool } from '../models/types';

const POLL_INTERVAL_MS = 30_000;

/**
 * Polls GET /api/v1/health and exposes scanner tool availability so the UI can
 * show which binaries are installed before a scan is launched.
 */
@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly api = inject(ApiService);

  readonly lastCheck = signal<HealthPayload | null>(null);
  readonly online = signal(false);
  readonly checking = signal(false);
  readonly version = signal('—');
  readonly availableTools = signal<ScannerTool[]>([]);
  readonly llmAvailable = signal(false);
  readonly llmModel = signal<string | undefined>(undefined);

  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    void this.check();
  }

  startPolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(), POLL_INTERVAL_MS);
  }

  stopPolling(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async check(): Promise<void> {
    this.checking.set(true);
    const health = await firstValueFrom(this.api.getHealth());
    this.checking.set(false);
    if (!health) {
      this.online.set(false);
      this.availableTools.set([]);
      this.llmAvailable.set(false);
      return;
    }
    this.online.set(true);
    this.lastCheck.set(health);
    this.version.set(health.version);
    const tools = (Object.keys(health.scanners) as ScannerTool[]).filter(
      (t) => health.scanners[t],
    );
    this.availableTools.set(tools);
    this.llmAvailable.set(health.llm.available);
    this.llmModel.set(health.llm.model);
  }
}
