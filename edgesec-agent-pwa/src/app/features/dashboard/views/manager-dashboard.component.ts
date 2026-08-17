import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { ProgressBarModule } from 'primeng/progressbar';
import { TableModule } from 'primeng/table';
import { ChartModule } from 'primeng/chart';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ScanService } from '../../../core/services/scan.service';
import { downloadFile } from '../shared/dashboard.utils';
import type { ScanMetrics } from '../../../core/models/types';

/**
 * Manager dashboard: high-level risk posture (risk score, severity mix,
 * scanner breakdown), recent scan history and one-click HTML report export.
 */
@Component({
  selector: 'app-manager-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    CardModule,
    ButtonModule,
    ProgressBarModule,
    TableModule,
    ChartModule,
    TagModule,
    TooltipModule,
  ],
  template: `
    <div class="grid">
      <!-- Risk score -->
      <p-card class="col-12 md:col-4">
        <ng-template pTemplate="header">
          <div class="card-title"><i class="pi pi-exclamation-triangle"></i> Risk Posture</div>
        </ng-template>
        <div class="risk-score">{{ metrics()?.riskScore ?? 0 }}</div>
        <div class="risk-label">
          <p-tag [value]="metrics()?.riskLevel ?? 'N/A'" [severity]="riskSeverity()" [rounded]="true" />
        </div>
        <p-progressbar [value]="riskPct()" [showValue]="false" [style]="{ marginTop: '1rem' }" />
        <div class="risk-subtext">Based on severity-weighted findings from the latest scan.</div>
      </p-card>

      <!-- Severity mix -->
      <p-card class="col-12 md:col-4">
        <ng-template pTemplate="header">
          <div class="card-title"><i class="pi pi-chart-pie"></i> Severity Mix</div>
        </ng-template>
        <div class="chart-wrap">
          <p-chart type="doughnut" [data]="severityChart()" [options]="doughnutOptions" height="220" />
        </div>
      </p-card>

      <!-- Scanner breakdown -->
      <p-card class="col-12 md:col-4">
        <ng-template pTemplate="header">
          <div class="card-title"><i class="pi pi-chart-bar"></i> Findings by Scanner</div>
        </ng-template>
        <div class="chart-wrap">
          <p-chart type="bar" [data]="scannerChart()" [options]="barOptions" height="220" />
        </div>
      </p-card>

      <!-- Recent scans -->
      <p-card class="col-12">
        <ng-template pTemplate="header">
          <div class="card-title">
            <i class="pi pi-history"></i>
            <span>Scan History</span>
            <span class="spacer"></span>
            <p-button
              label="Export HTML Report"
              icon="pi pi-download"
              size="small"
              severity="secondary"
              [disabled]="!scan.activeScan()"
              (onClick)="exportHtml()"
            />
          </div>
        </ng-template>
        <p-table [value]="history()" [paginator]="true" [rows]="8">
          <ng-template pTemplate="header">
            <tr>
              <th>Repo</th>
              <th>Status</th>
              <th>Findings</th>
              <th>Risk</th>
              <th>Date</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr [class.selected-row]="row.scanId === scan.activeScan()?.scanId">
              <td class="mono">{{ shortPath(row.repoPath) }}</td>
              <td><p-tag [value]="row.status" [severity]="statusSeverity(row.status)" [rounded]="true" /></td>
              <td>{{ row.metrics.totalFindings }}</td>
              <td>{{ row.metrics.riskScore }}</td>
              <td>{{ row.timestamp | date: 'MMM d, HH:mm' }}</td>
            </tr>
          </ng-template>
        </p-table>
      </p-card>
    </div>
  `,
  styles: [
    `
    .card-title { display: flex; align-items: center; gap: 0.6rem; font-weight: 600; padding: 1rem 1rem 0; }
    .card-title i { color: var(--accent-primary); }
    .spacer { flex: 1; }
    .risk-score { font-size: 3rem; font-weight: 800; text-align: center; padding-top: 0.5rem; }
    .risk-label { text-align: center; }
    .risk-subtext { font-size: 0.75rem; color: var(--text-muted); text-align: center; margin-top: 0.5rem; }
    .chart-wrap { padding: 0.5rem 1rem 1rem; }
    .mono { font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; }
    .selected-row { background: var(--bg-hover) !important; }
    `,
  ],
})
export class ManagerDashboardComponent {
  protected readonly scan = inject(ScanService);

  protected readonly metrics = computed<ScanMetrics | null>(() => this.scan.liveMetrics());

  protected readonly history = computed(() =>
    this.scan.cachedScans().map((r) => ({ ...r, status: r.status })),
  );

  protected readonly riskPct = computed(() => {
    const m = this.metrics();
    if (!m) return 0;
    return Math.min(100, Math.round((m.riskScore / 100) * 100));
  });

  protected readonly riskSeverity = computed<'danger' | 'warn' | 'success' | 'secondary'>(() => {
    const level = this.metrics()?.riskLevel;
    return level === 'CRITICAL' || level === 'HIGH' ? 'danger' : level === 'MEDIUM' ? 'warn' : 'success';
  });

  protected readonly severityChart = computed(() => {
    const m = this.metrics() ?? emptyMetrics();
    return {
      labels: ['Critical', 'High', 'Medium', 'Low', 'Info'],
      datasets: [
        {
          data: [m.criticalCount, m.highCount, m.mediumCount, m.lowCount, m.infoCount],
          backgroundColor: [
            'var(--severity-critical)',
            'var(--severity-high)',
            'var(--severity-medium)',
            'var(--severity-low)',
            'var(--severity-info)',
          ],
          borderWidth: 0,
        },
      ],
    };
  });

  protected readonly scannerChart = computed(() => {
    const m = this.metrics() ?? emptyMetrics();
    const tools = m.scannersUsed;
    const counts = tools.map((t) =>
      this.scan.liveFindings().filter((f) => f.tool === t).length,
    );
    return {
      labels: tools,
      datasets: [
        {
          label: 'Findings',
          data: counts,
          backgroundColor: 'var(--accent-primary)',
          borderRadius: 6,
        },
      ],
    };
  });

  protected readonly doughnutOptions = {
    cutout: '62%',
    plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-secondary)' } } },
  };

  protected readonly barOptions = {
    plugins: { legend: { display: false } },
    scales: {
      y: { beginAtZero: true, ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--border-primary)' } },
      x: { ticks: { color: 'var(--text-secondary)' }, grid: { display: false } },
    },
  };

  protected statusSeverity(s: string): 'success' | 'danger' | 'warn' | 'secondary' {
    if (s === 'completed') return 'success';
    if (s === 'failed') return 'danger';
    return 'warn';
  }

  protected shortPath(path: string): string {
    const parts = path.split(/[\\/]/);
    return parts.slice(-2).join('/') || path;
  }

  protected exportHtml(): void {
    const scan = this.scan.activeScan();
    if (!scan) return;
    const html = scan.htmlContent || `<pre>${JSON.stringify(scan, null, 2)}</pre>`;
    downloadFile(`edgesec-report-${scan.scanId}.html`, html, 'text/html;charset=utf-8');
  }
}

function emptyMetrics(): ScanMetrics {
  return {
    totalFindings: 0,
    criticalCount: 0,
    highCount: 0,
    mediumCount: 0,
    lowCount: 0,
    infoCount: 0,
    scannersUsed: [],
    riskScore: 0,
    riskLevel: 'LOW',
    durationSec: 0,
    filesAffected: 0,
  };
}
