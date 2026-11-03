import '../styles/common.css';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RotateCcw, X } from 'lucide-react';
import { Badge, Panel } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { translateRuntimeMessage } from '../lib/runtime-message';
function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const unit = value < 1024 ** 2 ? 'KiB' : value < 1024 ** 3 ? 'MiB' : 'GiB';
  const divider = unit === 'KiB' ? 1024 : unit === 'MiB' ? 1024 ** 2 : 1024 ** 3;
  return `${(value / divider).toFixed(1)} ${unit}`;
}
function DownloadQueue() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions();
  const { tasks, pending } = snapshot.downloads,
    desktop = snapshot.window.desktop,
    gameRunning = snapshot.launch.phase !== 'idle' || snapshot.activity !== null;
  const onCancel = (id: string) => {
      void actions.downloads.cancel(id);
    },
    onRetry = (id: string) => {
      void actions.downloads.retry(id);
    };
  return (
    <section data-ui-site="DownloadQueue-1">
      <div className="section-heading" data-ui-site="DownloadQueue-2">
        <h2 data-ui-site="DownloadQueue-3">
          {t('queue.title')}
          <span data-ui-site="DownloadQueue-4">{tasks.length}</span>
        </h2>
      </div>
      {!tasks.length ? (
        <Panel className="info-panel" data-ui-site="DownloadQueue-5">
          <Download size={19} data-ui-site="DownloadQueue-6" />
          <div data-ui-site="DownloadQueue-7">
            <strong data-ui-site="DownloadQueue-8">
              {desktop ? t('queue.empty') : t('queue.desktopTitle')}
            </strong>
            <p data-ui-site="DownloadQueue-9">
              {desktop ? t('queue.description') : t('queue.previewDescription')}
            </p>
          </div>
        </Panel>
      ) : (
        <div className="profile-list" data-ui-site="DownloadQueue-10">
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
              <Panel className="account-detail" key={task.id} data-ui-site="DownloadQueue-11">
                <div className="section-heading" data-ui-site="DownloadQueue-12">
                  <h2 data-ui-site="DownloadQueue-13">{task.name}</h2>
                  <Badge muted={task.status !== 'running'} data-ui-site="DownloadQueue-14">
                    {t(`queue.status.${task.status}`)}
                  </Badge>
                </div>
                <p data-ui-site="DownloadQueue-15">{translateRuntimeMessage(task.message, t)}</p>
                {progress && (
                  <Fragment data-ui-site="DownloadQueue-16">
                    <progress
                      aria-label={t('queue.progressLabel', { name: task.name })}
                      max={progressMax}
                      value={progressValue}
                      style={{ width: '100%', accentColor: 'var(--accent-ink)' }}
                      data-ui-site="DownloadQueue-17"
                    />
                    <p data-ui-site="DownloadQueue-18">
                      {bytes(completed)}
                      {total !== null && total !== undefined
                        ? ` / ${bytes(total)}`
                        : t('queue.unknownTotal')}
                      {percentage !== null ? ` · ${percentage.toFixed(1)}%` : ''} ·{' '}
                      {bytes(progress.bytes_per_second)}/s
                    </p>
                    <p data-ui-site="DownloadQueue-19">
                      {t('queue.files', {
                        completed: progress.completed_files,
                        total: progress.total_files,
                        reused: progress.reused_files,
                        failed: progress.failed_files,
                      })}
                    </p>
                    <p data-ui-site="DownloadQueue-20">
                      {t('queue.transferred', { bytes: bytes(progress.transferred_bytes) })}
                    </p>
                    {progress.current_file && (
                      <code data-ui-site="DownloadQueue-21">{progress.current_file}</code>
                    )}
                  </Fragment>
                )}
                <div className="button-group" data-ui-site="DownloadQueue-22">
                  {['queued', 'running'].includes(task.status) && (
                    <button
                      className="secondary small"
                      disabled={pending.includes(task.id)}
                      onClick={() => onCancel(task.id)}
                      data-ui-site="DownloadQueue-23"
                    >
                      <X size={14} data-ui-site="DownloadQueue-24" />
                      {t('queue.cancel')}
                    </button>
                  )}
                  {['failed', 'cancelled'].includes(task.status) && (
                    <button
                      className="secondary small"
                      disabled={pending.includes(task.id) || gameRunning}
                      onClick={() => onRetry(task.id)}
                      data-ui-site="DownloadQueue-25"
                    >
                      <RotateCcw size={14} data-ui-site="DownloadQueue-26" />
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
export default DownloadQueue;
