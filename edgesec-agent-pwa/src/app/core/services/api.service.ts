import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import type {
  BrowseResponse,
  HealthPayload,
  ScanReportPayload,
} from '../models/types';

export interface ScanStartRequest {
  repoPath: string;
  tools: string[];
}

export interface ScanListEntry {
  scanId: string;
  repoPath: string;
  status: string;
  createdAt: string;
  metricsSummary: {
    totalFindings: number;
    criticalCount: number;
    riskScore: number;
  };
}

/** Single HTTP client against the local edge agent backend. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  readonly baseUrl = environment.apiUrl;

  getBackendOnline(): Observable<boolean> {
    return this.http
      .get<{ status: 'ok' }>(`${this.baseUrl}/health`)
      .pipe(
        map(() => true),
        catchError(() => of(false)),
      );
  }

  getHealth(): Observable<HealthPayload | null> {
    return this.http.get<HealthPayload>(`${this.baseUrl}/health`).pipe(
      catchError((err: HttpErrorResponse) => {
        console.warn('[api] health check failed', err.status);
        return of(null);
      }),
    );
  }

  startScan(req: ScanStartRequest): Observable<{ scanId: string }> {
    return this.http
      .post<{ scanId: string }>(`${this.baseUrl}/scan`, req)
      .pipe(
        catchError((err: HttpErrorResponse) =>
          throwError(
            () => new Error(err.error?.detail ?? `Scan start failed (${err.status})`),
          ),
        ),
      );
  }

  getScanResult(scanId: string): Observable<ScanReportPayload> {
    return this.http.get<ScanReportPayload>(`${this.baseUrl}/scan-results/${scanId}`).pipe(
      catchError((err: HttpErrorResponse) =>
        throwError(
          () =>
            new Error(
              err.error?.detail ?? `Could not load scan result (${err.status})`,
            ),
        ),
      ),
    );
  }

  listScans(): Observable<ScanListEntry[]> {
    return this.http.get<ScanListEntry[]>(`${this.baseUrl}/scans`).pipe(
      catchError((err: HttpErrorResponse) => {
        console.warn('[api] scan listing failed', err.status);
        return of([]);
      }),
    );
  }

  /** List host directories (absolute paths) for the folder browser. */
  browseDir(path?: string | null): Observable<BrowseResponse> {
    const q = path ? `?path=${encodeURIComponent(path)}` : '';
    return this.http.get<BrowseResponse>(`${this.baseUrl}/browse${q}`).pipe(
      catchError((err: HttpErrorResponse) =>
        throwError(
          () => new Error(err.error?.detail ?? `Folder browse failed (${err.status})`),
        ),
      ),
    );
  }
}
