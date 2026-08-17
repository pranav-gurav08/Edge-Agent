import { Injectable, signal } from '@angular/core';

export type ThemeName = 'dark' | 'light';

const THEME_KEY = 'edgesec.theme';

/**
 * Toggles the app theme by toggling the `.dark-mode`/`.light-mode` class on the
 * document root. The PrimeNG Aura preset reads `darkModeSelector: '.dark-mode'`
 * to regenerate its component tokens automatically.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<ThemeName>('dark');

  constructor() {
    this.apply(this.readStored());
  }

  toggle(): ThemeName {
    const next: ThemeName = this.theme() === 'dark' ? 'light' : 'dark';
    this.apply(next);
    return next;
  }

  set(theme: ThemeName): void {
    this.apply(theme);
  }

  private apply(theme: ThemeName): void {
    this.theme.set(theme);
    const root = document.documentElement;
    root.classList.toggle('dark-mode', theme === 'dark');
    root.classList.toggle('light-mode', theme === 'light');
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }

  private readStored(): ThemeName {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return stored === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  }
}
