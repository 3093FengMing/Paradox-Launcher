import type { LogIdentity, LogLine } from '../types';
export const MAX_LOG_LINES = 500;
export interface LauncherLogLine extends LogLine {
  localSequence?: number;
}
export function sameLog(left: LogIdentity | undefined, right: LogIdentity): boolean {
  return left?.session === right.session && left.sequence === right.sequence;
}

export function afterLogBoundary(id: LogIdentity, boundary: LogIdentity): boolean {
  return id.session === boundary.session && BigInt(id.sequence) > BigInt(boundary.sequence);
}

export function insertLog(current: LauncherLogLine[], line: LauncherLogLine): LauncherLogLine[] {
  const id = line.id;
  if (id && current.some((previous) => sameLog(previous.id, id))) return current;
  const sequence = id ? BigInt(id.sequence) : null;
  const index = id
    ? current.findIndex(
        (previous) =>
          previous.id?.session === id.session &&
          sequence !== null &&
          BigInt(previous.id.sequence) > sequence,
      )
    : -1;
  // Event delivery can lag behind a newer disk snapshot or another event.
  const next = [...current];
  next.splice(index < 0 ? next.length : index, 0, line);
  return next.slice(-MAX_LOG_LINES);
}

export function mergeLogs(history: LogLine[], current: LauncherLogLine[]): LauncherLogLine[] {
  return [...history, ...current].reduce<LauncherLogLine[]>(insertLog, []);
}
