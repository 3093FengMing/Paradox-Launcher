import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, RotateCcw, X } from 'lucide-react';
import { UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import type { DeepReadonly, LauncherSnapshot } from '@paradox/launcher';
import { translateRuntimeMessage } from '../../common/lib/runtime-message';
import { formatDownloadBytes, getDownloadProgressDisplay, getDownloadFactValues, getDownloadActionState } from '../../common/lib/download-display';
import '../styles/downloads.css';

type Task = DeepReadonly<LauncherSnapshot['downloads']['tasks'][number]>;

function TaskProgress({ task }: { task: Task }) {
  const { t } = useTranslation();
  const progress = getDownloadProgressDisplay(task.progress);
  if (!progress) {
    return <p data-ui-site="DownloadQueue-no-progress" className="queue-no-progress">{t('versionDownloads.noProgress')}</p>;
  }
  return (
    <div data-ui-site="DownloadQueue-progress" className="queue-progress">
      <progress
        data-ui-site="DownloadQueue-progress-bar"
        aria-label={t(progress.labelKey, { name: task.name })}
        max={progress.max}
        value={progress.value}
      />
      <div data-ui-site="DownloadQueue-progress-copy" className="queue-progress-copy">
        <span data-ui-site="DownloadQueue-byte-count">
          {formatDownloadBytes(progress.completedBytes)}
          {progress.totalBytes !== null ? ` / ${formatDownloadBytes(progress.totalBytes)}` : t('queue.unknownTotal')}
        </span>
        <strong data-ui-site="DownloadQueue-percent">
          {progress.percent !== null ? `${progress.percent.toFixed(1)}%` : t('versionDownloads.filesProgress', { completed: progress.completedFiles, total: progress.totalFiles })}
        </strong>
        <span data-ui-site="DownloadQueue-speed">{formatDownloadBytes(progress.bytesPerSecond)}/s</span>
      </div>
    </div>
  );
}

function TaskDetails({ task }: { task: Task }) {
  const { t } = useTranslation();
  const facts = getDownloadFactValues(task.progress);
  const currentFile = task.progress?.current_file;
  return (
    <div data-ui-site="DownloadQueue-details-body" className="queue-details-body">
      <p data-ui-site="DownloadQueue-message" className="queue-message">{translateRuntimeMessage(task.message, t)}</p>
      {facts && (
        <dl data-ui-site="DownloadQueue-facts" className="queue-facts">
          <div data-ui-site="DownloadQueue-files">
            <dt data-ui-site="DownloadQueue-files-label">{t('versionDownloads.files')}</dt>
            <dd data-ui-site="DownloadQueue-files-value">{facts.files}</dd>
          </div>
          <div data-ui-site="DownloadQueue-downloaded">
            <dt data-ui-site="DownloadQueue-downloaded-label">{t('versionDownloads.downloaded')}</dt>
            <dd data-ui-site="DownloadQueue-downloaded-value">{facts.downloaded}</dd>
          </div>
          <div data-ui-site="DownloadQueue-reused">
            <dt data-ui-site="DownloadQueue-reused-label">{t('versionDownloads.reused')}</dt>
            <dd data-ui-site="DownloadQueue-reused-value">{facts.reused}</dd>
          </div>
          <div data-ui-site="DownloadQueue-failed">
            <dt data-ui-site="DownloadQueue-failed-label">{t('versionDownloads.failedFiles')}</dt>
            <dd data-ui-site="DownloadQueue-failed-value">{facts.failed}</dd>
          </div>
          <div data-ui-site="DownloadQueue-transferred">
            <dt data-ui-site="DownloadQueue-transferred-label">{t('versionDownloads.transferred')}</dt>
            <dd data-ui-site="DownloadQueue-transferred-value">{facts.transferred}</dd>
          </div>
          <div data-ui-site="DownloadQueue-active-bytes">
            <dt data-ui-site="DownloadQueue-active-bytes-label">{t('versionDownloads.activeBytes')}</dt>
            <dd data-ui-site="DownloadQueue-active-bytes-value">{facts.activeBytes}</dd>
          </div>
        </dl>
      )}
      {currentFile && (
        <div data-ui-site="DownloadQueue-current" className="queue-current">
          <span data-ui-site="DownloadQueue-current-label">{t('versionDownloads.currentFile')}</span>
          <code data-ui-site="DownloadQueue-current-file">{currentFile}</code>
        </div>
      )}
      <dl data-ui-site="DownloadQueue-identities" className="queue-identities">
        <div data-ui-site="DownloadQueue-id">
          <dt data-ui-site="DownloadQueue-id-label">{t('versionDownloads.taskId')}</dt>
          <dd data-ui-site="DownloadQueue-id-value"><code data-ui-site="DownloadQueue-id-code">{task.id}</code></dd>
        </div>
        {task.profile_key && (
          <div data-ui-site="DownloadQueue-profile">
            <dt data-ui-site="DownloadQueue-profile-label">{t('versionDownloads.instance')}</dt>
            <dd data-ui-site="DownloadQueue-profile-value"><code data-ui-site="DownloadQueue-profile-code">{task.profile_key}</code></dd>
          </div>
        )}
        {task.java_major !== null && (
          <div data-ui-site="DownloadQueue-java">
            <dt data-ui-site="DownloadQueue-java-label">Java</dt>
            <dd data-ui-site="DownloadQueue-java-value">{task.java_major}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function TaskActions({ task }: { task: Task }) {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const actions = getDownloadActionState(task, s.downloads.pending, s.launch.phase, !!s.activity);
  return (
    <div data-ui-site="DownloadQueue-task-actions" className="queue-task-actions">
      {actions.showCancel && (
        <button data-ui-site="DownloadQueue-cancel" className="secondary small" disabled={actions.cancelDisabled} onClick={() => void a.downloads.cancel(task.id)}>
          <X data-ui-site="DownloadQueue-cancel-icon" size={14}/>{t('queue.cancel')}
        </button>
      )}
      {actions.showCancelling && (
        <button data-ui-site="DownloadQueue-cancelling" className="secondary small" disabled>{t('queue.status.cancelling')}</button>
      )}
      {actions.showRetry && (
        <button data-ui-site="DownloadQueue-retry" className="secondary small" disabled={actions.retryDisabled} onClick={() => void a.downloads.retry(task.id)}>
          <RotateCcw data-ui-site="DownloadQueue-retry-icon" size={14}/>{t('queue.retry')}
        </button>
      )}
    </div>
  );
}

export default function DownloadQueue() {
  const s = useLauncherSnapshot(), { t } = useTranslation();
  const [status, setStatus] = useState('all'), [kind, setKind] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { tasks } = s.downloads;
  const filtered = tasks.filter(task => (status === 'all' || task.status === status) && (kind === 'all' || task.kind === kind));
  const selected = filtered.find(task => task.id === selectedId) ?? filtered[0];
  return <section data-ui-site="DownloadQueue-root" className="download-queue modern-queue">
    <div data-ui-site="DownloadQueue-filters" className="queue-filters">
      <label data-ui-site="DownloadQueue-status-label">{t('versionDownloads.status')}<select data-ui-site="DownloadQueue-status-filter" value={status} onChange={e => setStatus(e.target.value)}><option data-ui-site="DownloadQueue-status-all" value="all">{t('versionDownloads.allStatuses')}</option>{['queued', 'running', 'cancelling', 'cancelled', 'completed', 'failed'].map(value => <option data-ui-site="DownloadQueue-status-option" key={value} value={value}>{t(`queue.status.${value}`)}</option>)}</select></label>
      <label data-ui-site="DownloadQueue-kind-label">{t('versionDownloads.taskKind')}<select data-ui-site="DownloadQueue-kind-filter" value={kind} onChange={e => setKind(e.target.value)}>{['all', 'install', 'java', 'content', 'pack'].map(value => <option data-ui-site="DownloadQueue-kind-option" key={value} value={value}>{t(`versionDownloads.kinds.${value}`)}</option>)}</select></label>
      <span data-ui-site="DownloadQueue-count" className="queue-result-count">{t('versionDownloads.taskCount', { count: filtered.length, total: tasks.length })}</span>
    </div>
    {!filtered.length ? <div data-ui-site="DownloadQueue-empty" className="queue-empty"><Download data-ui-site="DownloadQueue-empty-icon" size={30}/><h3 data-ui-site="DownloadQueue-empty-title">{t(tasks.length ? 'versionDownloads.noTasksMatch' : s.window.desktop ? 'queue.empty' : 'queue.desktopTitle')}</h3><p data-ui-site="DownloadQueue-empty-copy">{t(tasks.length ? 'versionDownloads.changeFilters' : s.window.desktop ? 'queue.description' : 'queue.previewDescription')}</p>{tasks.length > 0 && <button data-ui-site="DownloadQueue-clear" className="secondary" onClick={() => { setStatus('all'); setKind('all'); }}>{t('versionDownloads.clearFilters')}</button>}</div> : <div data-ui-site="DownloadQueue-layout" className="queue-layout"><div data-ui-site="DownloadQueue-list" className="queue-list">{filtered.map(task => <UiIdentity key={task.id} namespace="download" value={task.id}><article data-ui-site="DownloadQueue-task" className={`queue-task ${selected?.id === task.id ? 'is-selected' : ''}`} data-status={task.status}><div data-ui-site="DownloadQueue-task-heading" className="queue-task-heading"><button data-ui-site="DownloadQueue-inspect" className="queue-inspect" aria-pressed={selected?.id === task.id} onClick={() => setSelectedId(task.id)}><span data-ui-site="DownloadQueue-kind" className="queue-kind">{t(`versionDownloads.kinds.${task.kind}`)}</span><strong data-ui-site="DownloadQueue-name">{task.name}</strong></button><span data-ui-site="DownloadQueue-status" className="queue-status">{t(`queue.status.${task.status}`)}</span></div><TaskProgress task={task}/><div data-ui-site="DownloadQueue-task-footer" className="queue-task-footer"><button data-ui-site="DownloadQueue-show-details" className="text-button" onClick={() => setSelectedId(task.id)}>{t('versionDownloads.details')}</button><TaskActions task={task}/></div></article></UiIdentity>)}</div>{selected && <UiIdentity namespace="download-detail" value={selected.id}><aside data-ui-site="DownloadQueue-details" className="queue-details" aria-label={t('versionDownloads.details')}><div data-ui-site="DownloadQueue-detail-heading" className="queue-detail-heading"><h3 data-ui-site="DownloadQueue-detail-name">{selected.name}</h3><span data-ui-site="DownloadQueue-detail-status" className="queue-status">{t(`queue.status.${selected.status}`)}</span></div><TaskDetails task={selected}/></aside></UiIdentity>}</div>}
  </section>;
}
