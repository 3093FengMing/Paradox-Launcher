import { useTranslation } from 'react-i18next';
import { ArrowUpRight, Download } from 'lucide-react';
import { UiView } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import DownloadQueue from '../components/DownloadQueue';
import '../styles/downloads.css';
export default function DownloadsPage() {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const active = s.downloads.tasks.filter(task => ['queued', 'running', 'cancelling'].includes(task.status)).length;
  const failed = s.downloads.tasks.filter(task => task.status === 'failed').length;
  const completed = s.downloads.tasks.filter(task => task.status === 'completed').length;
  return <section data-ui-site="DownloadsPage-root" className="downloads-page modern-downloads">
    <header data-ui-site="DownloadsPage-overview" className="downloads-overview"><div data-ui-site="DownloadsPage-intro" className="downloads-intro"><Download data-ui-site="DownloadsPage-icon" size={23}/><div data-ui-site="DownloadsPage-heading-copy"><h2 data-ui-site="DownloadsPage-title">{t('queue.title')}</h2><p data-ui-site="DownloadsPage-description">{t('versionDownloads.queueHint')}</p></div></div>{s.navigation.routes.some(route => route.id === 'custom.versions') && <button data-ui-site="DownloadsPage-versions" className="secondary small" onClick={() => a.navigation.navigate('custom.versions')}>{t('versionDownloads.browseVersions')}<ArrowUpRight data-ui-site="DownloadsPage-versions-icon" size={16}/></button>}</header>
    <div data-ui-site="DownloadsPage-counts" className="downloads-counts">{[['activeTasks', active], ['completedTasks', completed], ['failedTasks', failed]].map(([label, count]) => <div data-ui-site="DownloadsPage-metric" key={label}><strong data-ui-site="DownloadsPage-metric-count">{count}</strong><span data-ui-site="DownloadsPage-metric-label">{t(`versionDownloads.${label}`)}</span></div>)}</div>
    <UiView data-ui-site="DownloadsPage-queue" id="component.download-queue" Original={DownloadQueue}/>
  </section>;
}
