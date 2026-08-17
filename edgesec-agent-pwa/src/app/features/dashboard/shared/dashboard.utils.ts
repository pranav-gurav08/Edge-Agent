import type { ScanFinding } from '../../../core/models/types';

export function severityTag(
  severity: ScanFinding['severity'],
): 'danger' | 'warn' | 'success' | 'info' | 'secondary' {
  switch (severity) {
    case 'CRITICAL':
      return 'danger';
    case 'HIGH':
      return 'warn';
    case 'MEDIUM':
      return 'warn';
    case 'LOW':
      return 'success';
    default:
      return 'info';
  }
}

export function severityColor(severity: ScanFinding['severity']): string {
  switch (severity) {
    case 'CRITICAL':
      return 'var(--severity-critical)';
    case 'HIGH':
      return 'var(--severity-high)';
    case 'MEDIUM':
      return 'var(--severity-medium)';
    case 'LOW':
      return 'var(--severity-low)';
    default:
      return 'var(--severity-info)';
  }
}

/** Trigger a client-side file download from a string payload. */
export function downloadFile(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
