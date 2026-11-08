import type { DeepReadonly, LauncherSnapshot } from '@paradox/launcher';

type Task = DeepReadonly<LauncherSnapshot['downloads']['tasks'][number]>;
type Progress = NonNullable<Task['progress']>;

export function formatDownloadBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const divider = value < 1024 ** 2 ? 1024 : value < 1024 ** 3 ? 1024 ** 2 : 1024 ** 3;
  return `${(value / divider).toFixed(1)} ${divider === 1024 ? 'KiB' : divider === 1024 ** 2 ? 'MiB' : 'GiB'}`;
}

/** Derive display data without interpreting unknown byte totals as a percentage. */
export function getDownloadProgressDisplay(progress: Task['progress']) {
  if (!progress) return null;
  const completedBytes = progress.completed_bytes + progress.active_bytes;
  const totalBytes = progress.total_bytes;
  const knownBytes = totalBytes !== null && totalBytes > 0;
  const hasFileTotal = progress.total_files > 0;
  return {
    completedBytes,
    totalBytes,
    percent: knownBytes ? Math.min(100, Math.max(0, completedBytes / totalBytes * 100)) : null,
    labelKey: knownBytes || !hasFileTotal ? 'queue.progressLabel' : 'versionDownloads.fileProgress',
    max: knownBytes ? totalBytes : hasFileTotal ? progress.total_files : undefined,
    value: knownBytes ? Math.min(completedBytes, totalBytes) : hasFileTotal ? progress.completed_files : undefined,
    completedFiles: progress.completed_files,
    totalFiles: progress.total_files,
    bytesPerSecond: progress.bytes_per_second,
  };
}

/** Keep the same native counters and byte formatting in every suite's fact markup. */
export function getDownloadFactValues(progress: Progress | null) {
  if (!progress) return null;
  return {
    files: `${progress.completed_files} / ${progress.total_files}`,
    downloaded: progress.downloaded_files,
    reused: progress.reused_files,
    failed: progress.failed_files,
    transferred: formatDownloadBytes(progress.transferred_bytes),
    activeBytes: formatDownloadBytes(progress.active_bytes),
  };
}

/** Presentation gates only; the existing downloads owner still performs actions. */
export function getDownloadActionState(
  task: Task,
  pendingIds: readonly string[],
  launchPhase: LauncherSnapshot['launch']['phase'],
  hasActivity: boolean,
) {
  const pending = pendingIds.includes(task.id);
  return {
    showCancel: task.status === 'queued' || task.status === 'running',
    showCancelling: task.status === 'cancelling',
    showRetry: task.status === 'failed' || task.status === 'cancelled',
    cancelDisabled: pending,
    retryDisabled: pending || launchPhase !== 'idle' || hasActivity,
  };
}
