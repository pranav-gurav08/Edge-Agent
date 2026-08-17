import { Injectable, inject, signal } from '@angular/core';
import { db } from '../db/db';
import type { UamRole } from '../models/types';
import { ThemeService } from './theme.service';

const DEFAULT_ROLE: UamRole = 'dev';
const ROLE_KEY = 'edgesec.activeRole';

/**
 * Persists the active UAM role (dev / tester / devsecops / manager) to
 * IndexedDB and localStorage so the selection survives reloads.
 */
@Injectable({ providedIn: 'root' })
export class UamStateService {
  private readonly theme = inject(ThemeService);

  readonly activeRole = signal<UamRole>(DEFAULT_ROLE);

  private hydrated = false;

  constructor() {
    this.hydrate();
  }

  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const row = await db.session.orderBy('id').last();
      if (row?.currentRole) this.activeRole.set(row.currentRole as UamRole);
    } catch {
      /* fall back to default */
    }
  }

  async setRole(role: UamRole): Promise<void> {
    this.activeRole.set(role);
    try {
      await db.session.put({
        currentRole: role,
        theme: this.theme.theme(),
        updatedAt: new Date().toISOString(),
      });
    } catch {
      /* localStorage fallback */
    }
    try {
      localStorage.setItem(ROLE_KEY, role);
    } catch {
      /* ignore */
    }
  }
}
