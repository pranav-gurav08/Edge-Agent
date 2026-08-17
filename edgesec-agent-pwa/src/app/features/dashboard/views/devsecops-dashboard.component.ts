import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TabsModule } from 'primeng/tabs';
import { TooltipModule } from 'primeng/tooltip';
import { ScanService } from '../../../core/services/scan.service';
import { HealthService } from '../../../core/services/health.service';
import { downloadFile } from '../shared/dashboard.utils';
import { SCANNER_TOOLS } from '../../../core/models/types';

/**
 * DevSecOps dashboard: live scanner telemetry (binary availability, execution
 * time, finding counts), LLM usage, and the raw scanner JSON artifacts for
 * audit/debugging, exportable as an audit trail.
 */
@Component({
  selector: 'app-devsecops-dashboard',
  standalone: true,
  imports: [CommonModule, CardModule, ButtonModule, TagModule, TabsModule, TooltipModule],
  template: `
    <div class="grid">
      <!-- Scanner tool telemetry -->
      <p-card class="col-12 lg:col-7">
        <ng-template pTemplate="header">
          <div class="card-title">
            <i class="pi pi-shield"></i>
            <span>Scanner Telemetry</span>
            <span class="spacer"></span>
            <p-button
              label="Export Audit Trail"
              icon="pi pi-download"
              size="small"
              severity="secondary"
              [disabled]="!scan.activeScan()"
              (onClick)="exportAudit()"
            />
          </div>
        </ng-template>
        <div class="telemetry-grid">
          <div *ngFor="let tool of telemetryTools()" class="telemetry-card">
            <div class="telemetry-head">
              <i class="{{ toolIcon(tool.id) }}"></i>
              <span class="telemetry-name">{{ tool.label }}</span>
              <p-tag
                [value]="tool.available ? 'available' : 'missing'"
                [severity]="tool.available ? 'success' : 'danger'"
                [rounded]="true"
              />
            </div>
            <div class="telemetry-row">
              <span>Executed</span>
              <b>{{ tool.executed ? 'yes' : 'no' }}</b>
            </div>
            <div class="telemetry-row">
              <span>Duration</span>
              <b>{{ tool.durationMs }} ms</b>
            </div>
            <div class="telemetry-row">
              <span>Findings</span>
              <b>{{ tool.findingsCount }}</b>
            </div>
            <div *ngIf="tool.exitCode !== null" class="telemetry-row">
              <span>Exit code</span>
              <b>{{ tool.exitCode }}</b>
            </div>
          </div>
        </div>

        <!-- LLM telemetry -->
        <div class="llm-block">
          <div class="llm-title"><i class="pi pi-sparkles"></i> LLM Synthesis</div>
          <div class="telemetry-grid">
            <div class="telemetry-card">
              <div class="telemetry-head">
                <i class="pi pi-cpu"></i>
                <span class="telemetry-name">{{ llmStatus().model ?? 'Local LLM' }}</span>
                <p-tag [value]="llmStatus().status" [severity]="llmStatusSeverity()" [rounded]="true" />
              </div>
              <div class="telemetry-row"><span>Prompt tokens</span><b>{{ llmStatus().promptTokens ?? '—' }}</b></div>
              <div class="telemetry-row"><span>Completion tokens</span><b>{{ llmStatus().completionTokens ?? '—' }}</b></div>
              <div class="telemetry-row"><span>Latency</span><b>{{ llmStatus().latencyMs ?? '—' }} ms</b></div>
              <div *ngIf="llmStatus().note" class="telemetry-note">{{ llmStatus().note }}</div>
            </div>
          </div>
        </div>
      </p-card>

      <!-- Raw scanner JSON artifacts -->
      <p-card class="col-12 lg:col-5">
        <ng-template pTemplate="header">
          <div class="card-title">
            <i class="pi pi-database"></i>
            <span>Raw Artifacts</span>
          </div>
        </ng-template>
        <div *ngIf="!scan.activeScan()" class="empty">
          <i class="pi pi-inbox"></i>
          <p>No artifacts yet.</p>
        </div>
        <p-tabs *ngIf="scan.activeScan()" [value]="rawTab()" (valueChange)="onTabChange($event)">
          <p-tablist>
            <p-tab *ngFor="let tool of SCANNER_TOOLS" [value]="tool">{{ tool }}</p-tab>
          </p-tablist>
          <p-tabpanels>
            <p-tabpanel *ngFor="let tool of SCANNER_TOOLS" [value]="tool">
              <pre class="raw-json">{{ rawJson(tool) }}</pre>
            </p-tabpanel>
          </p-tabpanels>
        </p-tabs>
      </p-card>
    </div>
  `,
  styles: [
    `
    .card-title { display: flex; align-items: center; gap: 0.6rem; font-weight: 600; padding: 1rem 1rem 0; }
    .card-title i { color: var(--accent-primary); }
    .spacer { flex: 1; }
    .empty { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 2rem; color: var(--text-muted); }
    .empty i { font-size: 2rem; }
    .telemetry-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.75rem; padding: 0.75rem 1rem 0.5rem; }
    .telemetry-card { border: 1px solid var(--border-primary); border-radius: 10px; background: var(--bg-secondary); padding: 0.8rem; }
    .telemetry-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
    .telemetry-head i { color: var(--accent-primary); }
    .telemetry-name { font-weight: 600; font-size: 0.88rem; flex: 1; }
    .telemetry-row { display: flex; justify-content: space-between; font-size: 0.8rem; padding: 0.15rem 0; }
    .telemetry-row span { color: var(--text-muted); }
    .telemetry-note { font-size: 0.75rem; color: var(--status-warning); margin-top: 0.4rem; }
    .llm-block { padding: 0.5rem 1rem 1rem; }
    .llm-title { display: flex; gap: 0.5rem; align-items: center; font-weight: 600; font-size: 0.9rem; margin: 0.5rem 0; color: var(--text-secondary); }
    .llm-title i { color: var(--accent-secondary); }
    .raw-json {
      max-height: 480px; overflow: auto; font-size: 0.72rem; margin: 0;
      background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 8px;
    }
    `,
  ],
})
export class DevsecopsDashboardComponent {
  protected readonly scan = inject(ScanService);
  protected readonly health = inject(HealthService);
  protected readonly SCANNER_TOOLS = SCANNER_TOOLS;

  protected readonly rawTab = signal<string | number>('gitleaks');

  protected onTabChange(value: string | number): void {
    this.rawTab.set(value);
  }

  protected telemetryTools() {
    return SCANNER_TOOLS.map((tool) => {
      const artifact = this.scan.liveArtifacts()[tool];
      return {
        id: tool,
        label: tool.charAt(0).toUpperCase() + tool.slice(1),
        available: this.health.availableTools().includes(tool),
        executed: !!artifact,
        durationMs: artifact?.durationMs ?? 0,
        findingsCount: artifact?.findingsCount ?? 0,
        exitCode: artifact?.exitCode ?? null,
      };
    });
  }

  protected llmStatus() {
    const scan = this.scan.activeScan();
    if (!scan) return { status: 'skipped', model: undefined };
    try {
      return JSON.parse(scan.llmJson);
    } catch {
      return { status: 'skipped', model: undefined };
    }
  }

  protected llmStatusSeverity(): 'success' | 'warn' | 'danger' | 'secondary' {
    const s = this.llmStatus().status;
    return s === 'ok' ? 'success' : s === 'degraded' ? 'warn' : 'secondary';
  }

  protected rawJson(tool: string): string {
    const artifact = this.scan.liveArtifacts()[tool];
    if (!artifact) return `// ${tool} did not run in this scan`;
    return JSON.stringify(artifact.rawJson, null, 2);
  }

  protected toolIcon(tool: string): string {
    return tool === 'gitleaks' ? 'pi pi-key' : tool === 'trivy' ? 'pi pi-box' : 'pi pi-flag';
  }

  protected exportAudit(): void {
    const scan = this.scan.activeScan();
    if (!scan) return;
    const payload = {
      scanId: scan.scanId,
      repoPath: scan.repoPath,
      artifacts: JSON.parse(scan.artifactsJson || '{}'),
      llm: JSON.parse(scan.llmJson || '{}'),
      metrics: scan.metrics,
    };
    downloadFile(`edgesec-audit-${scan.scanId}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }
}
