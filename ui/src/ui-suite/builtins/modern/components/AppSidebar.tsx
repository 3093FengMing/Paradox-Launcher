import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Menu as MenuIcon } from 'lucide-react';
import { Menu, UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import type { UiRouteDescriptor, DeepReadonly } from '@paradox/launcher';
import { isDownloadCenterRoute, routeIcon } from '../../common/lib/navigation';
import { viewProps } from '../../common/lib/view';
import '../styles/instance-detail.css';
type SidebarProps = { profileKey?: string; detailSection?: string; onDetailSectionChange?: (section: string) => void };
const primaryRoutes = new Set(['home', 'instances', 'custom.versions', 'downloads', 'settings', 'logs']);
export default function AppSidebar(input?: SidebarProps & { props?: Readonly<Record<string, unknown>> }) {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const props = viewProps<SidebarProps>(input);
  const visible = s.navigation.routes.filter(r => r.navigation);
  const primary = visible.filter(route => primaryRoutes.has(route.id));
  const menuFontSize = `${Math.max(13, 14 * (s.appearance.value?.ui_scale ?? 100) / 100)}px`;


  const currentRoute = s.navigation.routes.find(route => route.id === (isDownloadCenterRoute(s.navigation.routeId) ? 'custom.versions' : s.navigation.routeId));
  const mobileNavigation = <div className={`mobile-navigation ${visible.some(route => !primaryRoutes.has(route.id)) ? 'has-extra-routes' : ''}`} data-ui-site="ModernSidebarMenu-bar">
    <Menu.Root data-ui-site="ModernSidebarMenu-root">
      <Menu.Trigger className="secondary mobile-navigation-trigger" aria-label={t('responsiveUi.navigation')} data-ui-site="ModernSidebarMenu-trigger"><MenuIcon size={16} aria-hidden="true" data-ui-site="ModernSidebarMenu-icon"/>{t('responsiveUi.navigation')}</Menu.Trigger>
      <Menu.Portal data-ui-site="ModernSidebarMenu-portal">
        <Menu.Positioner side="bottom" align="start" sideOffset={4} style={{ fontSize: menuFontSize }} className="modern-navigation-positioner modern-portal" data-ui-site="ModernSidebarMenu-positioner">
          <Menu.Popup style={{ fontSize: 'inherit' }} className="modern-navigation-menu modern-portal" data-ui-site="ModernSidebarMenu-popup">
            {visible.map(route => { const Icon = routeIcon(route.icon), label = t(route.title, { defaultValue: route.title }); return <UiIdentity key={route.id} namespace="route" value={route.id}>
              <Menu.Item style={{ fontSize: 'inherit' }} label={label} onClick={() => { if (route.id === 'settings') a.settings.setTab('appearance'); a.navigation.navigate(route.id); }} data-ui-site="ModernSidebarMenu-route">
                {Icon && <Icon size={16} aria-hidden="true" data-ui-site="ModernSidebarMenu-route-icon"/>}<span data-ui-site="ModernSidebarMenu-route-label">{label}</span>
              </Menu.Item>
            </UiIdentity>; })}
            {props.onDetailSectionChange && <>
              <Menu.Separator data-ui-site="ModernSidebarMenu-separator"/>
              {['overview', 'settings', 'mods', 'resourcepacks', 'shaderpacks', 'saves'].map(section => <UiIdentity key={section} namespace="section" value={section}>
                <Menu.Item style={{ fontSize: 'inherit' }} label={t(`shellHome.sections.${section}`)} onClick={() => props.onDetailSectionChange?.(section)} data-ui-site="ModernSidebarMenu-section">{t(`shellHome.sections.${section}`)}</Menu.Item>
              </UiIdentity>)}
            </>}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
    <span className="mobile-navigation-label" data-ui-site="ModernSidebarMenu-current">{currentRoute ? t(currentRoute.title, { defaultValue: currentRoute.title }) : t('nav.workspace')}</span>
  </div>;

  const renderRoute = (r: DeepReadonly<UiRouteDescriptor>) => {
    const Icon = routeIcon(r.icon), title = t(r.title, { defaultValue: r.title });
    const active = s.navigation.routeId === r.id || r.id === 'custom.versions' && isDownloadCenterRoute(s.navigation.routeId);
    return <button data-ui-site="AppSidebar-route" key={r.id} className={`nav-item ${active ? 'active' : ''}`} aria-label={title} title={title}
      aria-current={active ? 'page' : undefined} onClick={() => {
        if (r.id === 'settings') a.settings.setTab('appearance');
        a.navigation.navigate(r.id);
      }}>
      {Icon ? <Icon data-ui-site="AppSidebar-route-icon" size={18}  aria-hidden="true"/> : <span data-ui-site="AppSidebar-route-fallback" className="nav-fallback" aria-hidden="true">{title.slice(0,1)}</span>}
      <span data-ui-site="AppSidebar-route-title" className="nav-label">{title}</span>
      {r.id === 'instances' && <b data-ui-site="AppSidebar-count">{s.profiles.items.length}</b>}
      {r.id === 'logs' && s.logs.lines.some(line => line.level === 'error') && <i data-ui-site="AppSidebar-errors" className="error-dot" />}
    </button>;
  };
  return <Fragment>{mobileNavigation}<aside data-ui-site="AppSidebar-6" className="sidebar" aria-label={t('nav.workspace')}>
    <nav data-ui-site="AppSidebar-nav">{primary.filter(r => r.id !== 'settings' && r.id !== 'logs').map(renderRoute)}</nav>
    {props.onDetailSectionChange && <nav data-ui-site="AppSidebar-sections" className="detail-sections" aria-label={t('shellHome.instanceSections')}>
      {['overview', 'settings', 'mods', 'resourcepacks', 'shaderpacks', 'saves'].map(section => <button data-ui-site="AppSidebar-section" className={`nav-item ${props.detailSection === section ? 'active' : ''}`} key={section} onClick={() => props.onDetailSectionChange?.(section)} aria-current={props.detailSection === section ? 'true' : undefined}>{t(`shellHome.sections.${section}`)}</button>)}
    </nav>}
    <div data-ui-site="AppSidebar-bottom" className="sidebar-bottom">{primary.filter(r => r.id === 'settings' || r.id === 'logs').map(renderRoute)}</div>
  </aside></Fragment>;
}
