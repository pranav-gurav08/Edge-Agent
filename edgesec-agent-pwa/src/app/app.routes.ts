import { Routes } from '@angular/router';
import { ShellComponent } from './shared/layout/shell.component';
import { roleGuard } from './core/guards/role.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: '',
    component: ShellComponent,
    children: [
      {
        path: 'dashboard',
        canActivate: [roleGuard],
        data: { roles: ['dev', 'tester', 'devsecops', 'manager'] },
        loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
      },
      {
        path: 'reports',
        canActivate: [roleGuard],
        data: { roles: ['tester', 'manager', 'devsecops', 'dev'] },
        loadComponent: () => import('./features/reports/reports.component').then((m) => m.ReportsComponent),
      },
      {
        path: 'settings',
        canActivate: [roleGuard],
        data: { roles: ['dev', 'tester', 'devsecops', 'manager'] },
        loadComponent: () => import('./features/settings/settings.component').then((m) => m.SettingsComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'dashboard' },
];
