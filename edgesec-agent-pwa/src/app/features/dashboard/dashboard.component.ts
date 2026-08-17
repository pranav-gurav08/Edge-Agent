import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { CheckboxModule } from 'primeng/checkbox';
import { StepsModule } from 'primeng/steps';
import { CardModule } from 'primeng/card';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import type { MenuItem } from 'primeng/api';
import { ScanService } from '../../core/services/scan.service';
import { HealthService } from '../../core/services/health.service';
import { UamStateService } from '../../core/services/uam-state.service';
import { ApiService } from '../../core/services/api.service';
import { SCANNER_TOOLS, type BrowseEntry, type ScannerTool } from '../../core/models/types';
import { DevDashboardComponent } from './views/dev-dashboard.component';
import { TesterDashboardComponent } from './views/tester-dashboard.component';
import { DevsecopsDashboardComponent } from './views/devsecops-dashboard.component';
import { ManagerDashboardComponent } from './views/manager-dashboard.component';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    CheckboxModule,
    StepsModule,
    CardModule,
    DialogModule,
    TooltipModule,
    DevDashboardComponent,
    TesterDashboardComponent,
    DevsecopsDashboardComponent,
    ManagerDashboardComponent,
  ],
  template: `
    <div class="dashboard">
      <!-- Scan launcher -->
      <p-card [style]="{ marginBottom: '1rem' }">
        <ng-template pTemplate="header">
          <div class="card-title">
            <i class="pi pi-sync"></i>
            <span>Run Security Scan</span>
          </div>
        </ng-template>
        <div class="launcher">
          <div class="launcher-input">
            <button
              type="button"
              class="folder-picker-btn"
              (click)="openBrowser()"
              [pTooltip]="'Select Local Project Folder'"
              tooltipPosition="top"
              aria-label="Select local project folder"
            >
              <i class="pi pi-folder-open"></i>
            </button>
            <input
              pInputText
              class="w-full"
              type="text"
              placeholder="Absolute path to local repository, e.g. C:/repo/my-app"
              [(ngModel)]="repoPath"
              (keydown.enter)="onLaunch()"
            />
            <input
              #folderPicker
              type="file"
              webkitdirectory
              (change)="onFolderInput($event)"
              hidden
            />
          </div>
          <div *ngIf="pathHint()" class="path-hint">
            <i class="pi pi-info-circle"></i>
            <span>{{ pathHint() }}</span>
          </div>
          <div class="launcher-tools">
            <div
              *ngFor="let tool of tools"
              class="tool-toggle"
              [class.offline-tool]="!toolAvailable(tool.id)"
              [pTooltip]="toolAvailable(tool.id) ? 'Installed' : 'Binary not detected on the agent host'"
              tooltipPosition="top"
            >
              <p-checkbox
                [(ngModel)]="selectedTools"
                [value]="tool.id"
                [binary]="false"
                [disabled]="!toolAvailable(tool.id)"
                inputId="tool-{{ tool.id }}"
              />
              <label for="tool-{{ tool.id }}" [class.muted]="!toolAvailable(tool.id)">
                <i class="{{ tool.icon }}"></i> {{ tool.label }}
              </label>
            </div>
          </div>
          <div class="launcher-actions">
            <p-button
              label="Launch Scan"
              icon="pi pi-play"
              [loading]="scan.isScanning()"
              [disabled]="!repoPath().trim() || scan.isScanning()"
              (onClick)="onLaunch()"
            />
          </div>
        </div>

        <!-- Offline / backend error banner -->
        <div *ngIf="scan.scanError()" class="error-banner">
          <i class="pi pi-exclamation-triangle"></i>
          <span>{{ scan.scanError() }}</span>
        </div>

        <!-- Live progress steps -->
        <div *ngIf="scan.isScanning()" class="progress-steps">
          <p-steps [model]="stepsModel()" [readonly]="true" />
        </div>
      </p-card>

      <!-- Role-specific view -->
      <div [ngSwitch]="uam.activeRole()">
        <ng-container *ngSwitchCase="'dev'"><app-dev-dashboard /></ng-container>
        <ng-container *ngSwitchCase="'tester'"><app-tester-dashboard /></ng-container>
        <ng-container *ngSwitchCase="'devsecops'"><app-devsecops-dashboard /></ng-container>
        <ng-container *ngSwitchCase="'manager'"><app-manager-dashboard /></ng-container>
        <ng-container *ngSwitchDefault><app-dev-dashboard /></ng-container>
      </div>
    </div>

    <!-- Host folder browser -->
    <p-dialog
      header="Select Local Project Folder"
      [(visible)]="browserVisible"
      [style]="{ width: '560px', maxWidth: '92vw' }"
      [modal]="true"
      [dismissableMask]="true"
      [draggable]="false"
      [resizable]="false"
      [closable]="true"
    >
      <div class="browser">
        <div class="browser-bar">
          <button
            type="button"
            class="browser-nav"
            (click)="loadBrowse()"
            [pTooltip]="'Volumes'"
            tooltipPosition="top"
          >
            <i class="pi pi-desktop"></i>
          </button>
          <button
            type="button"
            class="browser-nav"
            [disabled]="!browseParent()"
            (click)="browseUp()"
            [pTooltip]="'Up one level'"
            tooltipPosition="top"
          >
            <i class="pi pi-arrow-up"></i>
          </button>
          <span class="browser-path mono">{{ browseCurrent() ?? 'Select a volume to browse' }}</span>
        </div>

        <div *ngIf="browseLoading()" class="browser-state">
          <i class="pi pi-spin pi-spinner"></i> Loading…
        </div>
        <div *ngIf="browseError()" class="browser-state error">{{ browseError() }}</div>

        <div class="browser-list" *ngIf="!browseLoading()">
          <div
            *ngFor="let entry of browseEntries(); trackBy: trackEntry"
            class="browser-item"
            [class.dir]="entry.isDir"
            (click)="entry.isDir && navigate(entry)"
            [pTooltip]="entry.path"
            tooltipPosition="top"
          >
            <i class="{{ entry.isDir ? 'pi pi-folder' : 'pi pi-file' }}"></i>
            <span class="browser-name">{{ entry.name }}</span>
            <i *ngIf="entry.isDir" class="pi pi-chevron-right browser-go"></i>
          </div>
          <div *ngIf="browseEntries().length === 0" class="browser-state">
            No subdirectories here.
          </div>
        </div>
      </div>
      <ng-template pTemplate="footer">
        <p-button
          label="System Picker"
          icon="pi pi-folder-open"
          size="small"
          severity="secondary"
          (onClick)="pickFolder()"
        />
        <p-button
          label="Select Folder"
          icon="pi pi-check"
          [disabled]="!browseCurrent()"
          (onClick)="selectFolder()"
        />
      </ng-template>
    </p-dialog>
  `,
  styles: [
    `
    .dashboard { display: flex; flex-direction: column; gap: 1rem; }
    .card-title { display: flex; align-items: center; gap: 0.6rem; font-weight: 600; padding: 1rem 1rem 0; }
    .card-title i { color: var(--accent-primary); }
    .launcher { display: flex; flex-direction: column; gap: 0.9rem; padding: 0.5rem 1rem 1rem; }
    .launcher-input { display: flex; gap: 0.5rem; }
    .folder-picker-btn {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0.55rem 0.8rem;
      border: 1px solid var(--border-secondary);
      border-radius: 8px;
      background: var(--bg-tertiary);
      color: var(--accent-primary);
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
    }
    .folder-picker-btn:hover {
      background: color-mix(in srgb, var(--accent-primary) 14%, transparent);
      border-color: var(--accent-primary);
    }
    .folder-picker-btn:focus-visible { outline: 2px solid var(--accent-primary); outline-offset: 2px; }
    .path-hint {
      display: flex; gap: 0.4rem; align-items: center;
      font-size: 0.78rem; color: var(--status-warning);
    }
    .launcher-tools { display: flex; gap: 1.25rem; flex-wrap: wrap; }
    .tool-toggle { display: flex; align-items: center; gap: 0.45rem; padding: 0.4rem 0.7rem; border: 1px solid var(--border-secondary); border-radius: 8px; background: var(--bg-tertiary); cursor: default; }
    .tool-toggle label { font-size: 0.85rem; font-weight: 500; cursor: pointer; }
    .tool-toggle.offline-tool { opacity: 0.55; }
    .tool-toggle label.muted { color: var(--text-muted); }
    .launcher-actions { display: flex; }
    .error-banner {
      margin: 0 1rem 0.75rem; padding: 0.6rem 0.8rem;
      border: 1px solid var(--status-error); border-radius: 8px;
      background: color-mix(in srgb, var(--status-error) 12%, transparent);
      color: var(--status-error); font-size: 0.85rem;
      display: flex; gap: 0.5rem; align-items: center;
    }
    .progress-steps { padding: 0 1rem 1rem; }
    .browser { display: flex; flex-direction: column; gap: 0.6rem; }
    .browser-bar { display: flex; align-items: center; gap: 0.5rem; }
    .browser-nav {
      display: inline-flex; align-items: center; justify-content: center;
      cursor: pointer; padding: 0.45rem 0.6rem;
      border: 1px solid var(--border-secondary); border-radius: 8px;
      background: var(--bg-tertiary); color: var(--accent-primary);
      font-size: 0.85rem; transition: background 0.15s ease, border-color 0.15s ease;
    }
    .browser-nav:hover:not(:disabled) { border-color: var(--accent-primary); }
    .browser-nav:disabled { opacity: 0.4; cursor: default; }
    .browser-path {
      flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-size: 0.8rem; color: var(--text-secondary);
    }
    .browser-list {
      max-height: 320px; overflow-y: auto;
      border: 1px solid var(--border-secondary); border-radius: 8px;
    }
    .browser-item {
      display: flex; align-items: center; gap: 0.55rem;
      padding: 0.45rem 0.7rem; font-size: 0.85rem;
      border-bottom: 1px solid color-mix(in srgb, var(--border-secondary) 45%, transparent);
      cursor: default;
    }
    .browser-item:last-child { border-bottom: none; }
    .browser-item i { color: var(--accent-secondary); }
    .browser-item.dir { cursor: pointer; }
    .browser-item.dir:hover { background: var(--bg-tertiary); }
    .browser-item:not(.dir) .browser-name { color: var(--text-muted); }
    .browser-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .browser-go { margin-left: auto; font-size: 0.7rem; color: var(--text-muted) !important; }
    .browser-state {
      display: flex; gap: 0.5rem; align-items: center;
      padding: 0.75rem; font-size: 0.85rem; color: var(--text-muted);
    }
    .browser-state.error { color: var(--status-error); }
    `,
  ],
})
export class DashboardComponent {
  protected readonly scan = inject(ScanService);
  protected readonly health = inject(HealthService);
  protected readonly uam = inject(UamStateService);
  private readonly api = inject(ApiService);

  protected readonly repoPath = signal('');
  protected readonly pathHint = signal('');
  private readonly folderPicker = viewChild<ElementRef<HTMLInputElement>>('folderPicker');
  protected readonly selectedTools = signal<ScannerTool[]>(['gitleaks', 'trivy']);
  protected readonly tools = SCANNER_TOOLS.map((id) => ({
    id,
    label: id.charAt(0).toUpperCase() + id.slice(1),
    icon: id === 'gitleaks' ? 'pi pi-key' : id === 'trivy' ? 'pi pi-box' : 'pi pi-flag',
  }));

  protected readonly browserVisible = signal(false);
  protected readonly browseCurrent = signal<string | null>(null);
  protected readonly browseParent = signal<string | null>(null);
  protected readonly browseEntries = signal<BrowseEntry[]>([]);
  protected readonly browseLoading = signal(false);
  protected readonly browseError = signal('');

  protected readonly stepsModel = computed<MenuItem[]>(() => {
    const s = this.scan.stages();
    const order: Array<keyof typeof s> = ['scanning', 'parsing', 'synthesis', 'report'];
    let activeIndex = 0;
    const items = order.map((stage, i) => {
      const st = s[stage];
      const done = st.status === 'completed';
      const running = st.status === 'running';
      if (done) activeIndex = Math.max(activeIndex, i + 1);
      return {
        label: stage.charAt(0).toUpperCase() + stage.slice(1),
        icon: done
          ? 'pi pi-check'
          : running
            ? 'pi pi-spin pi-spinner'
            : 'pi pi-circle-off',
        styleClass: done ? 'done' : running ? 'running' : '',
      };
    });
    return items;
  });

  protected toolAvailable(tool: ScannerTool): boolean {
    return this.health.availableTools().includes(tool);
  }

  protected onLaunch(): void {
    const path = this.repoPath().trim();
    const tools = this.selectedTools();
    if (!path) return;
    void this.scan.startScan(path, tools);
  }

  protected openBrowser(): void {
    this.browserVisible.set(true);
    if (this.browseCurrent() === null && !this.browseLoading()) {
      this.loadBrowse();
    }
  }

  protected loadBrowse(path?: string | null): void {
    this.browseLoading.set(true);
    this.browseError.set('');
    this.api.browseDir(path).subscribe({
      next: (res) => {
        this.browseCurrent.set(res.current);
        this.browseParent.set(res.parent);
        this.browseEntries.set(res.entries);
        this.browseLoading.set(false);
      },
      error: (err: Error) => {
        this.browseLoading.set(false);
        this.browseError.set(err.message ?? 'Could not browse the folder.');
      },
    });
  }

  protected navigate(entry: BrowseEntry): void {
    if (!entry.isDir) return;
    this.loadBrowse(entry.path);
  }

  protected browseUp(): void {
    const parent = this.browseParent();
    if (!parent) return;
    if (parent === this.browseCurrent()) {
      this.loadBrowse(); // filesystem root → back to volume list
      return;
    }
    this.loadBrowse(parent);
  }

  protected selectFolder(): void {
    const current = this.browseCurrent();
    if (!current) return;
    this.repoPath.set(current);
    this.pathHint.set('');
    this.browserVisible.set(false);
  }

  protected trackEntry(_index: number, entry: BrowseEntry): string {
    return entry.path;
  }

  protected async pickFolder(): Promise<void> {
    this.pathHint.set('');
    const w = window as unknown as {
      showDirectoryPicker?: () => Promise<{ name: string }>;
    };
    if (typeof w.showDirectoryPicker === 'function') {
      try {
        const handle = await w.showDirectoryPicker();
        this.repoPath.set(handle.name);
        this.browserVisible.set(false);
        this.pathHint.set(
          'Browsers hide absolute paths; the folder name was filled in. Enter the full absolute path (e.g. C:/repo/my-app) for scanning.',
        );
      } catch {
        return;
      }
      return;
    }
    const input = this.folderPicker()?.nativeElement;
    if (!input) return;
    input.setAttribute('webkitdirectory', '');
    input.click();
  }

  protected onFolderInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    input.value = '';
    this.pathHint.set('');
    if (files.length === 0) return;
    const first = files[0] as unknown as { path?: string; webkitRelativePath?: string };
    const native = first.path?.replace(/\\/g, '/');
    if (native) {
      this.repoPath.set(native);
      this.browserVisible.set(false);
      return;
    }
    const rel = first.webkitRelativePath?.split('/')[0];
    if (rel) {
      this.repoPath.set(rel);
      this.browserVisible.set(false);
      this.pathHint.set(
        'Your browser only exposes the folder name (absolute paths are hidden for security). Enter the full path, e.g. C:/repo/my-app.',
      );
    }
  }
}
