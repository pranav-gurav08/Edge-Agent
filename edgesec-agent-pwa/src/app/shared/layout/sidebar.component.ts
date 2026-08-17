import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TooltipModule } from 'primeng/tooltip';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, TooltipModule],
  template: `
    <aside class="app-sidebar">
      <nav>
        <a
          routerLink="/dashboard"
          routerLinkActive="active"
          class="nav-item"
          [pTooltip]="'Dashboard'"
          tooltipPosition="right"
        >
          <i class="pi pi-th-large"></i>
        </a>
        <a
          routerLink="/reports"
          routerLinkActive="active"
          class="nav-item"
          [pTooltip]="'Reports'"
          tooltipPosition="right"
        >
          <i class="pi pi-file"></i>
        </a>
        <a
          routerLink="/settings"
          routerLinkActive="active"
          class="nav-item"
          [pTooltip]="'Settings'"
          tooltipPosition="right"
        >
          <i class="pi pi-cog"></i>
        </a>
      </nav>
    </aside>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .app-sidebar {
      width: 56px;
      height: 100%;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border-primary);
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-top: 0.75rem;
    }
    nav { display: flex; flex-direction: column; gap: 0.4rem; width: 100%; align-items: center; }
    .nav-item {
      width: 40px; height: 40px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 10px;
      color: var(--text-secondary);
      font-size: 1.1rem;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .nav-item:hover { background: var(--bg-hover); color: var(--text-primary); }
    .nav-item.active { background: var(--accent-primary); color: #fff; }
  `,
})
export class SidebarComponent {}
