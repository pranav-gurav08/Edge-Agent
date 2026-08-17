import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { DividerModule } from 'primeng/divider';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule } from 'primeng/tooltip';
import { TagModule } from 'primeng/tag';
import { UamStateService } from '../../core/services/uam-state.service';
import { ThemeService } from '../../core/services/theme.service';
import { HealthService } from '../../core/services/health.service';
import { ApiService } from '../../core/services/api.service';
import { ScanService } from '../../core/services/scan.service';
import { environment } from '../../../environments/environment';

/**
 * Settings: backend connection status, UAM role preference, theme, and PWA
 * install. Prefer the real backend connection via /api/v1/health.
 */
@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    InputTextModule,
    ButtonModule,
    DividerModule,
    SelectButtonModule,
    TooltipModule,
    TagModule,
  ],
  template: `
    <div class="grid">
      <!-- Backend connection -->
      <p-card class="col-12 md:col-6">
        <ng-template pTemplate="header">
          <div class="card-title"><i class="pi pi-server"></i> Backend Agent</div>
        </ng-template>
        <div class="settings-body">
          <div class="field">
            <label>API endpoint</label>
            <span class="mono endpoint">{{ apiBase }}</span>
            <p-button
              icon="pi pi-refresh"
              size="small"
              severity="secondary"
              label="Re-check"
              [loading]="health.checking()"
              (onClick)="health.check()"
            />
          </div>

          <div class="status-line">
            <span class="status-dot" [class.online]="health.online()" [class.offline]="!health.online()"></span>
            <b>{{ health.online() ? 'Backend reachable' : 'Backend unreachable' }}</b>
            <span class="muted">v{{ health.version() }}</span>
          </div>

          <div class="llm-line">
            <i class="pi pi-sparkles"></i>
            <span>Local LLM: </span>
            <b>{{ health.llmModel() ?? (health.llmAvailable() ? 'available' : 'not detected') }}</b>
          </div>

          <div class="tools-line">
            <span>Detected scanners:</span>
            <p-tag
              *ngFor="let t of health.availableTools()"
              [value]="t"
              severity="success"
              styleClass="mr-1"
            />
            <span *ngIf="health.availableTools().length === 0" class="muted">none — install gitleaks / trivy on the agent host</span>
          </div>
        </div>
      </p-card>

      <!-- Preferences -->
      <p-card class="col-12 md:col-6">
        <ng-template pTemplate="header">
          <div class="card-title"><i class="pi pi-sliders-h"></i> Preferences</div>
        </ng-template>
        <div class="settings-body">
          <div class="field">
            <label>Appearance</label>
            <p-selectbutton
              [options]="themeOptions"
              [(ngModel)]="themeValue"
              optionLabel="label"
              optionValue="value"
              (ngModelChange)="onThemeChange($event)"
            />
          </div>

          <div class="field">
            <label>Default dashboard role</label>
            <p-selectbutton
              [options]="roleOptions"
              [(ngModel)]="roleValue"
              optionLabel="label"
              optionValue="value"
              (ngModelChange)="onRoleChange($event)"
            />
          </div>

          <p-divider />

          <div class="field">
            <label>Cache management</label>
            <div class="cache-stats">
              <span>{{ scan.cachedScans().length }} cached report(s)</span>
              <p-button
                label="Refresh cache list"
                icon="pi pi-refresh"
                size="small"
                severity="secondary"
                (onClick)="scan.loadCachedScans()"
              />
            </div>
          </div>
        </div>
      </p-card>
    </div>
  `,
  styles: [
    `
    .card-title { display: flex; align-items: center; gap: 0.6rem; font-weight: 600; padding: 1rem 1rem 0; }
    .card-title i { color: var(--accent-primary); }
    .settings-body { padding: 1rem; display: flex; flex-direction: column; gap: 1rem; }
    .field { display: flex; flex-direction: column; gap: 0.5rem; }
    .field label { font-size: 0.8rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
    .endpoint { background: var(--bg-tertiary); padding: 0.5rem 0.75rem; border-radius: 8px; display: inline-block; }
    .status-line { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }
    .status-line .status-dot { width: 10px; height: 10px; border-radius: 50%; }
    .status-dot.online { background: var(--status-success); }
    .status-dot.offline { background: var(--status-error); }
    .muted { color: var(--text-muted); }
    .llm-line { display: flex; gap: 0.5rem; align-items: center; font-size: 0.9rem; }
    .llm-line i { color: var(--accent-secondary); }
    .tools-line { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.9rem; }
    .cache-stats { display: flex; align-items: center; gap: 1rem; }
    `,
  ],
})
export class SettingsComponent {
  protected readonly health = inject(HealthService);
  protected readonly uam = inject(UamStateService);
  protected readonly theme = inject(ThemeService);
  protected readonly scan = inject(ScanService);
  protected readonly api = inject(ApiService);

  protected readonly apiBase = environment.apiUrl;

  protected themeValue = 'dark';
  protected roleValue = 'dev';

  themeOptions = [
    { label: 'Dark', value: 'dark' },
    { label: 'Light', value: 'light' },
  ];

  roleOptions = [
    { label: 'Developer', value: 'dev' },
    { label: 'QA Tester', value: 'tester' },
    { label: 'DevSecOps', value: 'devsecops' },
    { label: 'Manager', value: 'manager' },
  ];

  constructor() {
    this.themeValue = this.theme.theme();
    this.roleValue = this.uam.activeRole();
    void this.health.check();
  }

  onThemeChange(value: string): void {
    this.theme.set(value as 'dark' | 'light');
  }

  onRoleChange(value: string): void {
    void this.uam.setRole(value as 'dev' | 'tester' | 'devsecops' | 'manager');
  }
}
