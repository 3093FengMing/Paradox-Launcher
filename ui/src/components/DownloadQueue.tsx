import { useTranslation } from 'react-i18next';
import { Download, RotateCcw, X } from 'lucide-react';
import { Badge, Panel } from './ui';
import type { DownloadTask } from '../types';
import { translateRuntimeMessage } from '../i18n';

interface DownloadQueueProps {
  tasks: DownloadTask[];
  pending: string[];
  desktop: boolean;
  gameRunning: boolean;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
}
function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const unit = value < 1024 ** 2 ? 'KiB' : value < 1024 ** 3 ? 'MiB' : 'GiB';
  const divider = unit === 'KiB' ? 1024 : unit === 'MiB' ? 1024 ** 2 : 1024 ** 3;
  return `${(value / divider).toFixed(1)} ${unit}`;
}
export default function DownloadQueue({
  tasks,
  pending,
  desktop,
  gameRunning,
  onCancel,
  onRetry,
}: DownloadQueueProps) {
  const { t } = useTranslation();
  return (
    <section>
      <div className="section-heading">
        <h2>
          {t('queue.title')}
          <span>{tasks.length}</span>
        </h2>
      </div>
      {!tasks.length ? (
        <Panel className="info-panel">
          <Download size={19} />
          <div>
            <strong>{desktop ? t('queue.empty') : t('queue.desktopTitle')}</strong>
            <p>{desktop ? t('queue.description') : t('queue.previewDescription')}</p>
          </div>
        </Panel>
      ) : (
        <div className="profile-list">
          {tasks.map((task) => {
            const progress = task.progress;
            const completed = progress ? progress.completed_bytes + progress.active_bytes : 0;
            const total = progress?.total_bytes;
            const progressMax =
              total && total > 0
                ? total
                : progress && progress.total_files > 0
                  ? progress.total_files
                  : undefined;
            const progressValue =
              total && total > 0
                ? Math.min(completed, total)
                : progress && progress.total_files > 0
                  ? progress.completed_files
                  : undefined;
            const percentage = total && total > 0 ? Math.min(100, (completed / total) * 100) : null;
            return (
              <Panel className="account-detail" key={task.id}>
                <div className="section-heading">
                  <h2>{task.name}</h2>
                  <Badge muted={task.status !== 'running'}>
                    {t(`queue.status.${task.status}`)}
                  </Badge>
                </div>
                <p>{translateRuntimeMessage(task.message)}</p>
                {progress && (
                  <>
                    <progress
                      aria-label={t('queue.progressLabel', { name: task.name })}
                      max={progressMax}
                      value={progressValue}
                      style={{ width: '100%', accentColor: 'var(--accent-ink)' }}
                    />
                    <p>
                      {bytes(completed)}
                      {total !== null && total !== undefined
                        ? ` / ${bytes(total)}`
                        : t('queue.unknownTotal')}
                      {percentage !== null ? ` · ${percentage.toFixed(1)}%` : ''} ·{' '}
                      {bytes(progress.bytes_per_second)}/s
                    </p>
                    <p>
                      {t('queue.files', {
                        completed: progress.completed_files,
                        total: progress.total_files,
                        reused: progress.reused_files,
                        failed: progress.failed_files,
                      })}
                    </p>
                    <p>{t('queue.transferred', { bytes: bytes(progress.transferred_bytes) })}</p>
                    {progress.current_file && <code>{progress.current_file}</code>}
                  </>
                )}
                <div className="button-group">
                  {['queued', 'running'].includes(task.status) && (
                    <button
                      className="secondary small"
                      disabled={pending.includes(task.id)}
                      onClick={() => onCancel(task.id)}
                    >
                      <X size={14} />
                      {t('queue.cancel')}
                    </button>
                  )}
                  {['failed', 'cancelled'].includes(task.status) && (
                    <button
                      className="secondary small"
                      disabled={pending.includes(task.id) || gameRunning}
                      onClick={() => onRetry(task.id)}
                    >
                      <RotateCcw size={14} />
                      {t('queue.retry')}
                    </button>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </section>
  );
}
