import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TooltipModule } from 'primeng/tooltip';
import { TagModule } from 'primeng/tag';
import { ScanService } from '../../../core/services/scan.service';
import { HealthService } from '../../../core/services/health.service';
import { severityTag, downloadFile } from '../shared/dashboard.utils';
import type { ScanFinding } from '../../../core/models/types';

/**
 * Developer dashboard: vulnerabilities grouped by file with remediation
 * guidance, per-file re-scan and Markdown export of the full report.
 */
@Component({
  selector: 'app-dev-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    MarkdownModule,
    ButtonModule,
    CardModule,
    TooltipModule,
    TagModule,
  ],
  template: `
    <p-card>
      <ng-template pTemplate="header">
        <div class="card-title">
          <i class="pi pi-code"></i>
          <span>Developer Report</span>
          <span class="spacer"></span>
          <p-button
            label="Export Markdown"
            icon="pi pi-download"
            size="small"
            severity="secondary"
            [disabled]="!scan.activeScan()"
            (onClick)="exportMarkdown()"
          />
        </div>
      </ng-template>

      <div *ngIf="!scan.activeScan()" class="empty">
        <i class="pi pi-inbox"></i>
        <p>No scan data yet. Launch a scan from the top of the dashboard.</p>
      </div>

      <ng-container *ngIf="scan.activeScan()">
        <div class="summary-row">
          <div class="summary-chip">
            <span class="chip-label">Findings</span>
            <span class="chip-value">{{ scan.liveMetrics()?.totalFindings ?? 0 }}</span>
          </div>
          <div class="summary-chip">
            <span class="chip-label">Critical</span>
            <span class="chip-value" style="color: var(--severity-critical);">{{ scan.liveMetrics()?.criticalCount ?? 0 }}</span>
          </div>
          <div class="summary-chip">
            <span class="chip-label">High</span>
            <span class="chip-value" style="color: var(--severity-high);">{{ scan.liveMetrics()?.highCount ?? 0 }}</span>
          </div>
          <div class="summary-chip">
            <span class="chip-label">Files affected</span>
            <span class="chip-value">{{ filesAffected().length }}</span>
          </div>
        </div>

        <div class="content-grid">
          <!-- File navigation -->
          <div class="file-list">
            <div
              *ngFor="let file of filesAffected()"
              class="file-item"
              [class.selected]="file === selectedFile()"
              (click)="selectedFile.set(file)"
              [pTooltip]="file"
              tooltipPosition="left"
            >
              <i class="pi pi-file"></i>
              <span class="file-name">{{ shortName(file) }}</span>
              <span class="file-count">{{ countForFile(file) }}</span>
            </div>
          </div>

          <!-- Selected file findings + fixes, or full markdown report -->
          <div class="detail">
            <ng-container *ngIf="selectedFile(); else fullReport">
              <div class="file-heading">
                <i class="pi pi-folder-open"></i>
                <code>{{ selectedFile() }}</code>
                <span class="spacer"></span>
                <p-button
                  label="Re-scan file"
                  icon="pi pi-refresh"
                  size="small"
                  [loading]="rescanning()"
                  (onClick)="rescanFile()"
                />
              </div>
              <div *ngFor="let f of findingsForFile(selectedFile()!)" class="finding-card">
                <div class="finding-top">
                  <p-tag [value]="f.severity" [severity]="severityTag(f.severity)" />
                  <span class="finding-rule">{{ f.rule }}</span>
                  <span class="finding-loc">L{{ f.line ?? '?' }}</span>
                </div>
                <div class="finding-title">{{ f.title }}</div>
                <p class="finding-desc">{{ f.description }}</p>
                <div *ngIf="f.fix" class="fix-box">
                  <div class="fix-label"><i class="pi pi-wrench"></i> Suggested fix</div>
                  <pre>{{ f.fix }}</pre>
                </div>
                <div class="finding-meta">
                  <span>confidence: {{ f.confidence }}</span>
                  <span *ngIf="f.cwe">CWE-{{ f.cwe }}</span>
                  <span *ngIf="f.cvss">CVSS {{ f.cvss }}</span>
                </div>
              </div>
            </ng-container>
            <ng-template #fullReport>
              <div class="report-scroll">
                <markdown [data]="scan.activeScan()?.markdownContent ?? ''" />
              </div>
            </ng-template>
          </div>
        </div>
      </ng-container>
    </p-card>
  `,
  styles: [
    `
    .card-title { display: flex; align-items: center; gap: 0.6rem; font-weight: 600; padding: 1rem 1rem 0; }
    .card-title i { color: var(--accent-primary); }
    .spacer { flex: 1; }
    .empty { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 3rem; color: var(--text-muted); }
    .empty i { font-size: 2.5rem; }
    .summary-row { display: flex; gap: 1rem; padding: 0.75rem 1rem; flex-wrap: wrap; }
    .summary-chip { background: var(--bg-tertiary); border: 1px solid var(--border-primary); border-radius: 10px; padding: 0.5rem 0.9rem; min-width: 110px; }
    .chip-label { display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
    .chip-value { font-size: 1.35rem; font-weight: 700; }
    .content-grid { display: grid; grid-template-columns: 260px 1fr; gap: 1rem; padding: 0 1rem 1rem; }
    @media (max-width: 960px) { .content-grid { grid-template-columns: 1fr; } }
    .file-list { border: 1px solid var(--border-primary); border-radius: 10px; background: var(--bg-secondary); overflow-y: auto; max-height: 560px; }
    .file-item { display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0.75rem; cursor: pointer; border-bottom: 1px solid var(--border-primary); font-size: 0.82rem; }
    .file-item:hover { background: var(--bg-hover); }
    .file-item.selected { background: var(--bg-hover); border-left: 3px solid var(--accent-primary); }
    .file-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: 'JetBrains Mono', monospace; }
    .file-count { background: var(--accent-primary); color: #fff; border-radius: 999px; font-size: 0.7rem; padding: 0.1rem 0.5rem; }
    .detail { border: 1px solid var(--border-primary); border-radius: 10px; background: var(--bg-secondary); overflow-y: auto; max-height: 560px; }
    .file-heading { display: flex; align-items: center; gap: 0.5rem; padding: 0.7rem 0.9rem; border-bottom: 1px solid var(--border-primary); position: sticky; top: 0; background: var(--bg-secondary); z-index: 1; }
    .file-heading code { font-size: 0.85rem; }
    .finding-card { padding: 0.9rem; border-bottom: 1px solid var(--border-primary); }
    .finding-top { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.4rem; }
    .finding-rule { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: var(--text-secondary); }
    .finding-loc { margin-left: auto; font-size: 0.75rem; color: var(--text-muted); }
    .finding-title { font-weight: 600; font-size: 0.95rem; }
    .finding-desc { color: var(--text-secondary); font-size: 0.86rem; margin: 0.3rem 0; }
    .fix-box { background: var(--bg-tertiary); border: 1px solid var(--status-success); border-left-width: 3px; border-radius: 8px; padding: 0.7rem; margin-top: 0.5rem; }
    .fix-label { font-size: 0.75rem; font-weight: 600; color: var(--status-success); margin-bottom: 0.35rem; display: flex; gap: 0.35rem; align-items: center; }
    .fix-box pre { background: transparent; border: none; padding: 0; margin: 0; font-size: 0.8rem; white-space: pre-wrap; }
    .finding-meta { display: flex; gap: 0.9rem; font-size: 0.72rem; color: var(--text-muted); margin-top: 0.5rem; }
    .report-scroll { padding: 0 1rem; }
    `,
  ],
})
export class DevDashboardComponent {
  protected readonly scan = inject(ScanService);
  protected readonly health = inject(HealthService);

  protected readonly selectedFile = signal<string | null>(null);
  protected readonly rescanning = signal(false);

  protected filesAffected(): string[] {
    const set = new Set<string>();
    for (const f of this.scan.liveFindings()) {
      if (f.file) set.add(f.file);
    }
    return [...set].sort();
  }

  protected countForFile(file: string): number {
    return this.scan.liveFindings().filter((f) => f.file === file).length;
  }

  protected findingsForFile(file: string): ScanFinding[] {
    return this.scan
      .liveFindings()
      .filter((f) => f.file === file)
      .sort((a, b) => orderOf(a.severity) - orderOf(b.severity));
  }

  protected shortName(file: string): string {
    const parts = file.split(/[\\/]/);
    return parts.length > 2 ? parts.slice(-2).join('/') : file;
  }

  protected exportMarkdown(): void {
    const content = this.scan.activeScan()?.markdownContent;
    if (!content) return;
    downloadFile(
      `edgesec-report-${this.scan.activeScan()?.scanId}.md`,
      content,
      'text/markdown;charset=utf-8',
    );
  }

  protected async rescanFile(): Promise<void> {
    const file = this.selectedFile();
    const scan = this.scan.activeScan();
    if (!file || !scan) return;
    this.rescanning.set(true);
    try {
      const tools = scan.metrics.scannersUsed;
      await this.scan.startScan(file, tools);
    } finally {
      this.rescanning.set(false);
    }
  }

  protected severityTag(s: string): 'danger' | 'warn' | 'success' | 'info' | 'secondary' {
    return severityTag(s as ScanFinding['severity']);
  }
}

function orderOf(sev: string): number {
  const map: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
  return map[sev] ?? 5;
}
