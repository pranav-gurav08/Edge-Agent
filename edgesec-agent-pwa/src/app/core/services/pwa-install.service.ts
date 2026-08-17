import { Injectable, signal } from '@angular/core';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Wraps the `beforeinstallprompt` event so a manual "Install App" button can be
 * shown instead of relying on the browser's native affordance.
 */
@Injectable({ providedIn: 'root' })
export class PwaInstallService {
  readonly installPrompt = signal<BeforeInstallPromptEvent | null>(null);
  readonly canInstall = signal(false);
  readonly installed = signal(false);

  private deferred: BeforeInstallPromptEvent | null = null;

  constructor() {
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
      this.installPrompt.set(this.deferred);
      this.canInstall.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.installPrompt.set(null);
      this.canInstall.set(false);
      this.installed.set(true);
    });
  }

  async promptInstall(): Promise<void> {
    const prompt = this.deferred ?? this.installPrompt();
    if (!prompt) return;
    await prompt.prompt();
    await prompt.userChoice;
    this.deferred = null;
    this.installPrompt.set(null);
    this.canInstall.set(false);
  }
}
