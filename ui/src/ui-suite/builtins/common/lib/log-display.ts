import type { DeepReadonly, LauncherSnapshot } from '@paradox/launcher';

type LogLine = DeepReadonly<LauncherSnapshot['logs']['lines'][number]>;
export interface DisplayLogRow { key: string; line: LogLine }

/** Presentation keys only; optional native identity is never exposed as a session filter. */
export function displayLogRows(lines: readonly LogLine[]): DisplayLogRow[] {
  const occurrences = new Map<string, number>();
  return lines.map(line => {
    const base = line.id
      ? JSON.stringify(['native', line.id.session, line.id.sequence])
      : JSON.stringify(['line', line.time, line.level, line.message]);
    const occurrence = occurrences.get(base) ?? 0;
    occurrences.set(base, occurrence + 1);
    return { key: JSON.stringify([base, occurrence]), line };
  });
}

export function displayLogLevels(lines: readonly LogLine[]): string[] {
  return [...new Set(lines.map(line => line.level))].sort();
}

export function filterLogRows(rows: readonly DisplayLogRow[], query: string, level: string): DisplayLogRow[] {
  const needle = query.toLowerCase();
  return rows.filter(({ line }) => (!level || line.level === level)
    && [line.time, line.level, line.message].some(value => value.toLowerCase().includes(needle)));
}
