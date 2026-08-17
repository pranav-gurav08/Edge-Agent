import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule } from 'primeng/tooltip';
import { ButtonModule } from 'primeng/button';
import { UamStateService } from '../../core/services/uam-state.service';
import { ThemeService } from '../../core/services/theme.service';
import { HealthService } from '../../core/services/health.service';
import { PwaInstallService } from '../../core/services/pwa-install.service';
import { UAM_ROLE_META, type UamRole } from '../../core/models/types';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    FormsModule,
    SelectButtonModule,
    TooltipModule,
    ButtonModule,
  ],
  template: `
    <header class="app-header">
      <div class="brand">
        <span class="brand-icon pi pi-shield"></span>
        <div class="brand-text">
          <h1>EdgeSec Agent</h1>
          <span class="brand-sub">Edge-native security PWA</span>
        </div>
      </div>

      <div class="header-actions">
        <!-- Backend connectivity + tool availability -->
        <div class="status-pill" [class.online]="health.online()" [class.offline]="!health.online()">
          <span class="status-dot"></span>
          <span>{{ health.online() ? 'Agent Online' : 'Agent Offline' }}</span>
          <i
            class="pi pi-info-circle"
            [pTooltip]="tooltipHtml"
            tooltipPosition="bottom"
          ></i>
        </div>

        <!-- UAM role segmented control -->
        <p-selectbutton
          class="role-switcher"
          [options]="roleOptions"
          [(ngModel)]="activeRole"
          optionLabel="label"
          optionValue="id"
          (ngModelChange)="onRoleChange($event)"
        />

        <p-button
          *ngIf="install.canInstall()"
          icon="pi pi-download"
          label="Install"
          size="small"
          severity="secondary"
          (onClick)="install.promptInstall()"
        />

        <p-button
          [icon]="theme.theme() === 'dark' ? 'pi pi-sun' : 'pi pi-moon'"
          rounded
          text
          severity="secondary"
          (onClick)="theme.toggle()"
          [pTooltip]="theme.theme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          tooltipPosition="bottom"
        />
      </div>
    </header>
  `,
  styles: `
    :host { display: block; }
    .app-header {
      height: var(--header-height);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 0 1.25rem;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border-primary);
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .brand { display: flex; align-items: center; gap: 0.75rem; min-width: 0; }
    .brand-icon {
      width: 40px; height: 40px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 10px;
      background: var(--accent-primary);
      color: #fff;
      font-size: 1.25rem;
    }
    .brand-text h1 { font-size: 1.05rem; line-height: 1.2; }
    .brand-sub { font-size: 0.72rem; color: var(--text-muted); }
    .header-actions { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
    .status-pill {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.4rem 0.75rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      border: 1px solid var(--border-secondary);
      background: var(--bg-tertiary);
      cursor: default;
    }
    .status-pill.online { color: var(--status-success); }
    .status-pill.offline { color: var(--status-error); }
    .status-pill .status-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: currentColor;
    }
    .role-switcher :host ::ng-deep .p-selectbutton { box-shadow: none; }
  `,
})
export class HeaderComponent implements OnInit {
  readonly uam = inject(UamStateService);
  readonly theme = inject(ThemeService);
  readonly health = inject(HealthService);
  readonly install = inject(PwaInstallService);

  activeRole!: UamRole;
  roleOptions = Object.values(UAM_ROLE_META).map((m) => ({
    id: m.id,
    label: m.label,
    icon: m.icon,
  }));

  ngOnInit(): void {
    this.activeRole = this.uam.activeRole();
  }

  onRoleChange(role: UamRole): void {
    void this.uam.setRole(role);
  }

  get tooltipHtml(): string {
    const tools = this.health.availableTools();
    const llm = this.health.llmAvailable() ? this.health.llmModel() ?? 'LLM online' : 'LLM unavailable';
    const list = tools.length ? tools.join(', ') : 'none installed';
    return `Backend v${this.health.version()} &middot; tools: ${list} &middot; ${llm}`;
  }
}
