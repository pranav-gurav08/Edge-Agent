import { Injectable, inject, signal } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ApiService } from './api.service';
import type { ProgressEvent } from '../models/types';

/**
 * Real-time progress channel. Falls back from WebSocket to Server-Sent Events
 * when the WS handshake cannot be established, so progress still streams over
 * plain HTTP in restrictive environments.
 */
@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private readonly api = inject(ApiService);
  private socket: WebSocket | null = null;
  private es: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private scanId = '';
  private listeners = new Set<(evt: ProgressEvent) => void>();

  readonly online = signal(false);

  /** Subscribe to typed progress events. */
  onEvent(cb: (evt: ProgressEvent) => void): void {
    this.listeners.add(cb);
  }

  connect(scanId: string): void {
    this.close();
    this.scanId = scanId;
    const ws = this.buildWsUrl();
    try {
      this.socket = new WebSocket(ws);
      this.socket.onopen = () => {
        this.online.set(true);
        this.startHeartbeat();
      };
      this.socket.onmessage = (m) => this.dispatch(this.parse(m.data));
      this.socket.onclose = () => {
        this.online.set(false);
        this.stopHeartbeat();
        this.fallbackToSse();
      };
      this.socket.onerror = () => {
        this.online.set(false);
      };
    } catch {
      this.fallbackToSse();
    }
  }

  close(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = null;
    }
    if (this.es) {
      this.es.close();
      this.es = null;
    }
    this.stopHeartbeat();
    this.online.set(false);
  }

  private fallbackToSse(): void {
    if (!this.scanId) return;
    this.socket = null;
    const url = `${this.api.baseUrl}/scan-events/${this.scanId}`;
    try {
      this.es = new EventSource(url);
      this.es.onopen = () => this.online.set(true);
      this.es.onmessage = (m) => this.dispatch(this.parse(m.data));
      this.es.onerror = () => {
        /* EventSource reconnects automatically; keep last state. */
      };
    } catch {
      this.online.set(false);
    }
  }

  private parse(raw: string): ProgressEvent {
    try {
      return JSON.parse(raw) as ProgressEvent;
    } catch {
      return { type: 'stage_progress', stage: 'scanning', percent: 0 };
    }
  }

  private dispatch(evt: ProgressEvent): void {
    for (const cb of this.listeners) cb(evt);
  }

  private buildWsUrl(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}${environment.wsUrl}/scan/${this.scanId}`;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send('ping');
      }
    }, 15000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}
