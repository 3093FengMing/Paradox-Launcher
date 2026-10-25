import type { LogLine } from '../types';

export function exportLogs(logs: readonly LogLine[]): void {
  const content = logs.map((line) => `[${line.time}] [${line.level}] ${line.message}`).join('\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'paradox-launcher.log';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Release after the browser has consumed the download URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
