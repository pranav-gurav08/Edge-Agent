import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HealthService } from './core/services/health.service';
import { ThemeService } from './core/services/theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class AppComponent {
  private readonly health = inject(HealthService);
  private readonly theme = inject(ThemeService);

  constructor() {
    this.theme.set(this.theme.theme());
    this.health.startPolling();
  }
}
