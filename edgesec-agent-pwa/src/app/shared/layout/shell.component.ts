import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './header.component';
import { SidebarComponent } from './sidebar.component';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, SidebarComponent],
  template: `
    <div class="shell">
      <app-header />
      <div class="shell-body">
        <app-sidebar />
        <main class="shell-main">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .shell { display: flex; flex-direction: column; height: 100vh; }
    .shell-body { flex: 1; display: flex; min-height: 0; }
    .shell-main {
      flex: 1;
      min-width: 0;
      overflow-y: auto;
      padding: 1.25rem;
      background: var(--bg-primary);
    }
  `,
})
export class ShellComponent {}
