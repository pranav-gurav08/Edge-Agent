import { CanActivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { UamStateService } from '../services/uam-state.service';

/**
 * Ensures the session (active role + theme) is hydrated from IndexedDB before
 * any route renders. Route data.roles is advisory only — every dashboard shows
 * all four UAM views with a role switcher.
 */
export const roleGuard: CanActivateFn = async () => {
  const uam = inject(UamStateService);
  await uam.hydrate();
  return true;
};
