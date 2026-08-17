import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { DropdownModule } from 'primeng/dropdown';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { TooltipModule } from 'primeng/tooltip';
import { ScanService } from '../../../core/services/scan.service';
import { db } from '../../../core/db/db';
import { severityTag, severityColor, downloadFile } from '../shared/dashboard.utils';
import type { FindingStatusOption, ScanFinding } from '../../../core/models/types';

interface FindingRow {
  finding: ScanFinding;
  verification: FindingStatusOption;
}

/**
 * QA Tester dashboard: verifies findings and tracks remediation. Verification
 * decisions are persisted locally (IndexedDB) so the QA trail survives offline.
 */
@Component({
  selector: 'app-tester-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    TagModule,
    DropdownModule,
    CardModule,
    TooltipModule,
  ],
  template: `
    <p-card>
      <ng-template pTemplate="header">
        <div class="card-title">
          <i class="pi pi-check-square"></i>
          <span>QA Verification Board</span>
          <span class="spacer"></span>
          <p-button
            label="Export Verification Log"
            icon="pi pi-download"
            size="small"
            severity="secondary"
            [disabled]="rows().length === 0"
            (onClick)="exportLog()"
          />
        </div>
      </ng-template>

      <div *ngIf="rows().length === 0" class="empty">
        <i class="pi pi-inbox"></i>
        <p>No findings to verify yet.</p>
      </div>

      <div *ngIf="rows().length > 0" class="table-wrap">
        <p-table
          [value]="rows()"
          [paginator]="true"
          [rows]="12"
          [rowsPerPageOptions]="[12, 25, 50]"
          scrollable="scrollable"
          scrollHeight="480px"
        >
          <ng-template pTemplate="header">
            <tr>
              <th style="width: 5%">Severity</th>
              <th style="width: 22%">Title</th>
              <th style="width: 18%">File</th>
              <th style="width: 10%">Rule</th>
              <th style="width: 12%">Status</th>
              <th style="width: 20%">QA Decision</th>
              <th style="width: 13%">Notes</th>
            </tr>
          </ng-template>
          <ng-template pTemplate="body" let-row>
            <tr>
              <td>
                <p-tag [value]="row.finding.severity" [severity]="severityTag(row.finding.severity)" />
              </td>
              <td [pTooltip]="row.finding.description" tooltipPosition="top">
                {{ row.finding.title }}
              </td>
              <td class="mono">{{ shortPath(row.finding.file) }}</td>
              <td class="mono">{{ row.finding.rule }}</td>
              <td>
                <span class="status-pill" [ngStyle]="{ color: severityColor(row.finding.severity) }">
                  {{ row.verification }}
                </span>
              </td>
              <td>
                <p-dropdown
                  [options]="statusOptions"
                  [(ngModel)]="row.verification"
                  optionLabel="label"
                  optionValue="value"
                  (ngModelChange)="onStatusChange(row)"
                  [style]="{ width: '150px' }"
                />
              </td>
              <td>
                <p-button
                  icon="pi pi-tag"
                  rounded
                  text
                  severity="secondary"
                  [pTooltip]="notesFor(row.finding.id) || 'Add note'"
                  (onClick)="addNote(row.finding)"
                />
              </td>
            </tr>
          </ng-template>
        </p-table>
      </div>
    </p-card>
  `,
  styles: [
    `
    .card-title { display: flex; align-items: center; gap: 0.6rem; font-weight: 600; padding: 1rem 1rem 0; }
    .card-title i { color: var(--accent-primary); }
    .spacer { flex: 1; }
    .empty { display: flex; flex-direction: column; align-items: center; gap: 0.5rem; padding: 3rem; color: var(--text-muted); }
    .empty i { font-size: 2.5rem; }
    .table-wrap { padding: 0.75rem 1rem 1rem; }
    .mono { font-family: 'JetBrains Mono', monospace; font-size: 0.8rem; }
    .status-pill { text-transform: uppercase; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.03em; }
    `,
  ],
})
export class TesterDashboardComponent {
  protected readonly scan = inject(ScanService);

  statusOptions: { label: string; value: FindingStatusOption }[] = [
    { label: 'Open', value: 'open' },
    { label: 'Verified', value: 'verified' },
    { label: 'Rejected (FP)', value: 'rejected' },
    { label: 'Fixed', value: 'fixed' },
  ];

  readonly rows = computed<FindingRow[]>(() => {
    const scan = this.scan.activeScan();
    if (!scan) return [];
    const findings = this.parseFindings(scan);
    return findings.map((finding) => ({
      finding,
      verification: this.readVerification(finding.id),
    }));
  });

  private verificationCache = new Map<string, FindingStatusOption>();
  private noteCache = new Map<string, string>();

  async onStatusChange(row: FindingRow): Promise<void> {
    this.verificationCache.set(row.finding.id, row.verification);
    const scan = this.scan.activeScan();
    if (!scan) return;
    await db.verifications.put({
      findingId: row.finding.id,
      scanId: scan.scanId,
      decision: row.verification,
      note: this.noteCache.get(row.finding.id) ?? '',
      updatedAt: new Date().toISOString(),
    });
  }

  async addNote(finding: ScanFinding): Promise<void> {
    const current = this.noteCache.get(finding.id) ?? '';
    const note = window.prompt('QA note for this finding', current);
    if (note === null) return;
    this.noteCache.set(finding.id, note);
    const scan = this.scan.activeScan();
    if (!scan) return;
    await db.verifications.put({
      findingId: finding.id,
      scanId: scan.scanId,
      decision: this.verificationCache.get(finding.id) ?? 'open',
      note,
      updatedAt: new Date().toISOString(),
    });
  }

  notesFor(findingId: string): string {
    return this.noteCache.get(findingId) ?? '';
  }

  private readVerification(findingId: string): FindingStatusOption {
    const cached = this.verificationCache.get(findingId);
    if (cached) return cached;
    void this.hydrate(findingId);
    return 'open';
  }

  private async hydrate(findingId: string): Promise<void> {
    const scan = this.scan.activeScan();
    if (!scan) return;
    try {
      const row = await db.verifications.get({ scanId: scan.scanId, findingId });
      if (row) {
        this.verificationCache.set(findingId, row.decision);
        if (row.note) this.noteCache.set(findingId, row.note);
      }
    } catch {
      /* ignore */
    }
  }

  protected shortPath(path: string): string {
    const parts = path.split(/[\\/]/);
    return parts.slice(-2).join('/');
  }

  private parseFindings(scan: { findingsJson: string }): ScanFinding[] {
    try {
      return JSON.parse(scan.findingsJson) as ScanFinding[];
    } catch {
      return this.scan.liveFindings();
    }
  }

  protected async exportLog(): Promise<void> {
    const scan = this.scan.activeScan();
    if (!scan) return;
    const findings = this.parseFindings(scan);
    const lines = findings.map((f) => {
      const status = this.verificationCache.get(f.id) ?? 'open';
      return `[${status.toUpperCase()}] ${f.severity}\t${f.rule}\t${f.file}\t${f.title}`;
    });
    downloadFile(`edgesec-qa-log-${scan.scanId}.txt`, lines.join('\n'));
  }

  protected severityTag(s: string): 'danger' | 'warn' | 'success' | 'info' | 'secondary' {
    return severityTag(s as ScanFinding['severity']);
  }

  protected severityColor(s: string): string {
    return severityColor(s as ScanFinding['severity']);
  }
}
