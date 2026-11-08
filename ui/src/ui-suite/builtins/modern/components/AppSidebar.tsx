import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, ChevronRight, Menu as MenuIcon } from 'lucide-react';
import { Menu, UiIdentity, UiView } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import type { UiRouteDescriptor, DeepReadonly } from '@paradox/launcher';
import { routeIcon } from '../../common/lib/navigation';
import { resolveActiveAccount } from '../../common/lib/launcher-display';
import { viewProps } from '../../common/lib/view';
import '../styles/instance-detail.css';
type SidebarProps = { profileKey?: string; detailSection?: string; onDetailSectionChange?: (section: string) => void };
export default function AppSidebar(input?: SidebarProps & { props?: Readonly<Record<string, unknown>> }) {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const props = viewProps<SidebarProps>(input), account = resolveActiveAccount(s);
  const visible = s.navigation.routes.filter(r => r.navigation);
  const operationDisabled = !s.window.desktop || !!s.activity || s.settings.saving || s.downloads.active || s.downloads.pending.length > 0 || s.content.pending;


  const currentRoute = s.navigation.routes.find(route => route.id === s.navigation.routeId);
  const mobileNavigation = <div className="mobile-navigation" data-ui-site="ModernSidebarMenu-bar">
    <Menu.Root data-ui-site="ModernSidebarMenu-root">
      <Menu.Trigger className="secondary mobile-navigation-trigger" aria-label={t('responsiveUi.navigation')} data-ui-site="ModernSidebarMenu-trigger"><MenuIcon size={16} aria-hidden="true" data-ui-site="ModernSidebarMenu-icon"/>{t('responsiveUi.navigation')}</Menu.Trigger>
      <Menu.Portal data-ui-site="ModernSidebarMenu-portal">
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className="modern-navigation-positioner" data-ui-site="ModernSidebarMenu-positioner">
          <Menu.Popup className="modern-navigation-menu" data-ui-site="ModernSidebarMenu-popup">
            {visible.map(route => { const Icon = routeIcon(route.icon), label = t(route.title, { defaultValue: route.title }); return <UiIdentity key={route.id} namespace="route" value={route.id}>
              <Menu.Item label={label} onClick={() => { if (route.id === 'settings') a.settings.setTab('appearance'); a.navigation.navigate(route.id); }} data-ui-site="ModernSidebarMenu-route">
                {Icon && <Icon size={16} aria-hidden="true" data-ui-site="ModernSidebarMenu-route-icon"/>}<span data-ui-site="ModernSidebarMenu-route-label">{label}</span>
              </Menu.Item>
            </UiIdentity>; })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
    <span className="mobile-navigation-label" data-ui-site="ModernSidebarMenu-current">{currentRoute ? t(currentRoute.title, { defaultValue: currentRoute.title }) : t('nav.workspace')}</span>
  </div>;

  const accounts = visible.find(r => r.id === 'accounts');

  const renderRoute = (r: DeepReadonly<UiRouteDescriptor>) => {
    const Icon = routeIcon(r.icon), title = t(r.title, { defaultValue: r.title });
    return <button data-ui-site="AppSidebar-route" key={r.id} className={`nav-item ${s.navigation.routeId === r.id ? 'active' : ''}`} aria-label={title} title={title}
      aria-current={s.navigation.routeId === r.id ? 'page' : undefined} onClick={() => {
        if (r.id === 'settings') a.settings.setTab('appearance');
        a.navigation.navigate(r.id);
      }}>
      {Icon ? <Icon data-ui-site="AppSidebar-route-icon" size={18} /> : <span data-ui-site="AppSidebar-route-fallback" className="nav-fallback" aria-hidden="true">{title.slice(0,1)}</span>}
      <span data-ui-site="AppSidebar-route-title" className="nav-label">{title}</span>
      {r.id === 'instances' && <b data-ui-site="AppSidebar-count">{s.profiles.items.length}</b>}
      {r.id === 'logs' && s.logs.lines.some(line => line.level === 'error') && <i data-ui-site="AppSidebar-errors" className="error-dot" />}
    </button>;
  };
  const avatar = <UiView data-ui-site="AppSidebar-avatar" id="component.account-avatar" props={{ account: account.account, name: account.name }} />;
  return <Fragment>{mobileNavigation}<aside data-ui-site="AppSidebar-6" className="sidebar" aria-label={t('nav.workspace')}>
    <div data-ui-site="AppSidebar-brand" className="sidebar-brand"><Box data-ui-site="AppSidebar-brand-icon" size={23} /><strong data-ui-site="AppSidebar-brand-title">Paradox<small data-ui-site="AppSidebar-brand-edition">Minecraft Launcher</small></strong></div>
    {accounts && <button data-ui-site="AppSidebar-account" className={`sidebar-account ${s.navigation.routeId === 'accounts' ? 'active' : ''}`} aria-label={t('app.openAccount')} title={`${account.name} · ${t(account.kind === 'microsoft' ? 'auth.microsoftIdentity' : 'common.offlineAccount')}`}
      onClick={() => a.navigation.navigate(accounts.id)}>
      {account.account ? <UiIdentity namespace="account" value={account.account.id}>{avatar}</UiIdentity> : avatar}
      <span data-ui-site="AppSidebar-account-copy" className="sidebar-account-copy"><strong data-ui-site="AppSidebar-name">{account.name}</strong><small data-ui-site="AppSidebar-kind">{t(account.kind === 'microsoft' ? 'auth.microsoftIdentity' : 'common.offlineAccount')}</small></span>
      <ChevronRight data-ui-site="AppSidebar-account-arrow" size={14} />
    </button>}

    <div data-ui-site="AppSidebar-caption" className="nav-caption">{t('nav.workspace')}</div>
    <nav data-ui-site="AppSidebar-nav">{visible.filter(r => r.id !== 'accounts' && r.id !== 'settings' && r.id !== 'logs').map(renderRoute)}</nav>
    {s.navigation.routeId === 'instances' && <div data-ui-site="AppSidebar-storage" className="instance-sidebar-storage"><span data-ui-site="AppSidebar-storage-label">{t('instancePages.baseRoot')}</span><code data-ui-site="AppSidebar-storage-path">{s.profiles.items.find(item => item.profile.instance_key === s.profiles.activeKey)?.profile.game_directory ?? s.config.value?.settings.game_directory}</code><button data-ui-site="AppSidebar-import" className="text-button" disabled={operationDisabled} onClick={() => a.importDraft.open()}>{t('instances.import')}</button><button data-ui-site="AppSidebar-pack-import" className="text-button" disabled={operationDisabled} onClick={() => void a.content.importPack()}>{t('content.importPack')}</button></div>}
    {props.onDetailSectionChange && <nav data-ui-site="AppSidebar-sections" className="detail-sections" aria-label={t('shellHome.instanceSections')}>
      {['overview', 'settings', 'mods', 'resourcepacks', 'shaderpacks', 'saves'].map(section => <button data-ui-site="AppSidebar-section" className={`nav-item ${props.detailSection === section ? 'active' : ''}`} key={section} onClick={() => props.onDetailSectionChange?.(section)} aria-current={props.detailSection === section ? 'true' : undefined}>{t(`shellHome.sections.${section}`)}</button>)}
    </nav>}
    <div data-ui-site="AppSidebar-bottom" className="sidebar-bottom">{visible.filter(r => r.id === 'settings' || r.id === 'logs').map(renderRoute)}
      <p data-ui-site="AppSidebar-environment" className="sidebar-environment">{t(s.window.desktop ? 'shellHome.desktop' : 'nav.preview')}</p>
    </div>
  </aside></Fragment>;
}
