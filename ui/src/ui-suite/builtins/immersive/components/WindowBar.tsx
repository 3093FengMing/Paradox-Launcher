import { useTranslation } from 'react-i18next';
import { Box, CircleHelp, Minus, Square, X } from 'lucide-react';
import { DragRegion, UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { routeIcon } from '../../common/lib/navigation';
import { appVersion } from '../../common/lib/version';
export default function WindowBar() {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const settings = s.navigation.routes.some(r => r.id === 'settings' && r.navigation);
  const run = (operation: 'minimize' | 'maximize' | 'requestClose') => {
    if (s.window.desktop) void a.window[operation]().catch(error => a.notifications.publish('error', String(error)));
  };
  return <DragRegion data-ui-site="WindowBar-1" className="window-bar" role="banner">
    <div data-ui-site="WindowBar-2" className="window-title"><Box data-ui-site="WindowBar-3" size={18} />
      <span data-ui-site="WindowBar-4">Paradox Launcher <small data-ui-site="WindowBar-5">v{appVersion}</small></span>
    </div>
    <nav data-ui-site="WindowBar-navigation" className="window-navigation" aria-label={t('nav.workspace')}>
      {s.navigation.routes.filter(route => route.navigation).map(route => {
        const Icon = routeIcon(route.icon), label = t(route.title, { defaultValue: route.title });
        return <UiIdentity key={route.id} namespace="route" value={route.id}>
          <button data-ui-site="WindowBar-route" className="window-route" title={label} aria-label={label}
            aria-current={s.navigation.routeId === route.id || route.id === 'instances' && s.navigation.routeId === 'custom.instance-details' ? 'page' : undefined}
            onClick={() => a.navigation.navigate(route.id)}>
            {Icon && <Icon data-ui-site="WindowBar-route-icon" size={16} aria-hidden="true" />}
            <span data-ui-site="WindowBar-route-label">{label}</span>
          </button>
        </UiIdentity>;
      })}
    </nav>
    <div data-ui-site="WindowBar-6" className="window-controls">
      {settings && <button data-ui-site="WindowBar-7" aria-label={t('window.help')} title={t('window.help')}
        onClick={() => { a.settings.setTab('appearance'); a.navigation.navigate('settings'); }}><CircleHelp data-ui-site="WindowBar-8" size={17} /></button>}
      <button data-ui-site="WindowBar-9" disabled={!s.window.desktop} aria-label={t('window.minimize')} title={t('window.minimizeTitle')} onClick={() => run('minimize')}><Minus data-ui-site="WindowBar-10" size={17} /></button>
      <button data-ui-site="WindowBar-11" disabled={!s.window.desktop} aria-label={t('window.maximize')} title={t('window.maximizeTitle')} onClick={() => run('maximize')}><Square data-ui-site="WindowBar-12" size={13} /></button>
      <button data-ui-site="WindowBar-13" disabled={!s.window.desktop} className="window-close" aria-label={t('window.close')} title={t('window.closeTitle')} onClick={() => run('requestClose')}><X data-ui-site="WindowBar-14" size={19} /></button>
    </div>
  </DragRegion>;
}
