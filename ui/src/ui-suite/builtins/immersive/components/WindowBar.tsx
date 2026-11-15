import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, CircleHelp, Ellipsis, Menu as MenuIcon, Minus, Square, X } from 'lucide-react';
import { DragRegion, Menu, UiIdentity } from '@paradox/ui';
import type { UiRouteId } from '@paradox/launcher';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { isDownloadCenterRoute, routeIcon } from '../../common/lib/navigation';
import { appVersion } from '../../common/lib/version';
export default function WindowBar() {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const [compactNavigation, setCompactNavigation] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 900px)');
    const update = () => setCompactNavigation(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const visible = s.navigation.routes.filter(route => route.navigation);
  const primaryIds = ['home', 'instances', 'custom.versions', 'settings'];
  const primary = primaryIds.flatMap(id => visible.filter(route => route.id === id));
  const secondary = visible.filter(route => !primaryIds.includes(route.id));
  const menuRoutes = compactNavigation ? [...primary, ...secondary] : secondary;
  const NavigationIcon = compactNavigation ? MenuIcon : Ellipsis;
  const active = (id: string) => id === s.navigation.routeId
    || id === 'instances' && s.navigation.routeId === 'custom.instance-details'
    || id === 'custom.versions' && isDownloadCenterRoute(s.navigation.routeId);
  const navigate = (id: UiRouteId) => { if (id === 'settings') a.settings.setTab('appearance'); a.navigation.navigate(id); };
  const settings = s.navigation.routes.some(r => r.id === 'settings' && r.navigation);
  const run = (operation: 'minimize' | 'maximize' | 'requestClose') => {
    if (s.window.desktop) void a.window[operation]().catch(error => a.notifications.publish('error', String(error)));
  };
  return <DragRegion data-ui-site="WindowBar-1" className="window-bar" role="banner">
    <div data-ui-site="WindowBar-2" className="window-title"><Box data-ui-site="WindowBar-3" size={18} aria-hidden="true" />
      <span data-ui-site="WindowBar-4" title={`Paradox Launcher · ${appVersion}`}>Paradox Launcher <small data-ui-site="WindowBar-5">v{appVersion}</small></span>
    </div>
    <nav data-ui-site="WindowBar-navigation" className="window-navigation" aria-label={t('nav.workspace')}>
      {primary.map(route => {
        const Icon = routeIcon(route.icon), label = t(route.title, { defaultValue: route.title });
        return <UiIdentity key={route.id} namespace="route" value={route.id}>
          <button data-ui-site="WindowBar-route" className="window-route" title={label} aria-label={label}
            aria-current={active(route.id) ? 'page' : undefined}
            onClick={() => navigate(route.id)}>
            {Icon && <Icon data-ui-site="WindowBar-route-icon" size={16} aria-hidden="true" />}
            <span data-ui-site="WindowBar-route-label">{label}</span>
          </button>
        </UiIdentity>;
      })}
    </nav>
    <Menu.Root data-ui-site="WindowBar-menu-root">
      <Menu.Trigger data-ui-site="WindowBar-menu-trigger" className="window-navigation-trigger"
        aria-label={t(compactNavigation ? 'responsiveUi.navigation' : 'nav.more')} title={t(compactNavigation ? 'responsiveUi.navigation' : 'nav.more')}>
        <NavigationIcon data-ui-site="WindowBar-menu-icon" size={17} aria-hidden="true" />
        <span data-ui-site="WindowBar-menu-label">{t(compactNavigation ? 'responsiveUi.navigation' : 'nav.more')}</span>
      </Menu.Trigger>
      <Menu.Portal data-ui-site="WindowBar-menu-portal">
        <Menu.Positioner data-ui-site="WindowBar-menu-positioner" side="bottom" align="end" sideOffset={6}
          className="immersive-navigation-positioner immersive-portal" style={{ fontSize: Math.max(13, 14 * (s.appearance.value?.ui_scale ?? 100) / 100) }}>
          <Menu.Popup data-ui-site="WindowBar-menu-popup" className="immersive-navigation-menu immersive-portal" style={{ fontSize: 'inherit' }}>
            {menuRoutes.map(route => { const Icon = routeIcon(route.icon), label = t(route.title, { defaultValue: route.title });
              return <UiIdentity key={route.id} namespace="route" value={route.id}>
                <Menu.Item data-ui-site="WindowBar-menu-route" label={label} onClick={() => navigate(route.id)} style={{ fontSize: 'inherit' }}>
                  {Icon && <Icon data-ui-site="WindowBar-menu-route-icon" size={17} aria-hidden="true" />}
                  <span data-ui-site="WindowBar-menu-route-label">{label}</span>
                </Menu.Item>
              </UiIdentity>;
            })}
            {settings && <Menu.Separator data-ui-site="WindowBar-menu-separator" className="mobile-navigation-separator" />}
            {settings && <Menu.Item data-ui-site="WindowBar-7" label={t('window.help')} style={{ fontSize: 'inherit' }}
              onClick={() => { a.settings.setTab('appearance'); a.navigation.navigate('settings'); }}><CircleHelp data-ui-site="WindowBar-8" size={17} aria-hidden="true" />{t('window.help')}</Menu.Item>}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
    <div data-ui-site="WindowBar-6" className="window-controls">
      <button data-ui-site="WindowBar-9" disabled={!s.window.desktop} aria-label={t('window.minimize')} title={t('window.minimizeTitle')} onClick={() => run('minimize')}><Minus data-ui-site="WindowBar-10" size={17} /></button>
      <button data-ui-site="WindowBar-11" disabled={!s.window.desktop} aria-label={t('window.maximize')} title={t('window.maximizeTitle')} onClick={() => run('maximize')}><Square data-ui-site="WindowBar-12" size={13} /></button>
      <button data-ui-site="WindowBar-13" disabled={!s.window.desktop} className="window-close" aria-label={t('window.close')} title={t('window.closeTitle')} onClick={() => run('requestClose')}><X data-ui-site="WindowBar-14" size={19} /></button>
    </div>
  </DragRegion>;
}
