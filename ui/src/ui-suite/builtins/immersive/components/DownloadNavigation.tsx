import { useTranslation } from 'react-i18next';
import { Boxes, History, Package } from 'lucide-react';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import type { UiRouteId } from '@paradox/launcher';

export default function DownloadNavigation() {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const navigate = (routeId: UiRouteId) => {
    const profileKey = s.navigation.params.profileKey;
    a.navigation.navigate(routeId, profileKey ? { profileKey } : undefined);
  };
  return <nav className="download-navigation" aria-label={t('downloadCenter.sections')} data-ui-site="DownloadNavigation-root">
    <div className="download-navigation-tabs" data-ui-site="DownloadNavigation-tabs">
      <button type="button" className="download-navigation-tab" aria-current={s.navigation.routeId === 'custom.versions' ? 'page' : undefined}
        onClick={() => navigate('custom.versions')} data-ui-site="DownloadNavigation-versions">
        <Boxes size={17} aria-hidden="true" data-ui-site="DownloadNavigation-versions-icon"/><span data-ui-site="DownloadNavigation-versions-label">{t('downloadCenter.versions')}</span>
      </button>
      <button type="button" className="download-navigation-tab" aria-current={s.navigation.routeId === 'content' ? 'page' : undefined}
        onClick={() => navigate('content')} data-ui-site="DownloadNavigation-content">
        <Package size={17} aria-hidden="true" data-ui-site="DownloadNavigation-content-icon"/><span data-ui-site="DownloadNavigation-content-label">{t('downloadCenter.resources')}</span>
      </button>
    </div>
    <button type="button" className="download-navigation-history" aria-current={s.navigation.routeId === 'downloads' ? 'page' : undefined}
      onClick={() => navigate('downloads')} data-ui-site="DownloadNavigation-tasks">
      <History size={16} aria-hidden="true" data-ui-site="DownloadNavigation-tasks-icon"/><span data-ui-site="DownloadNavigation-tasks-label">{t('downloadCenter.taskRecords')}</span>
    </button>
  </nav>;
}
