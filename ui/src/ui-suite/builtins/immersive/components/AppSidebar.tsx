import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Check, ChevronRight, Menu as MenuIcon } from 'lucide-react';
import { Menu, UiIdentity, UiView } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import type { UiRouteDescriptor, DeepReadonly } from '@paradox/launcher';
import { routeIcon } from '../../common/lib/navigation';
import { resolveActiveAccount, resolveProfileEntry } from '../../common/lib/launcher-display';
import { viewProps } from '../../common/lib/view';
import '../styles/instance-detail.css';
type SidebarProps = { profileKey?: string; detailSection?: string; onDetailSectionChange?: (section: string) => void };
export default function AppSidebar(input?: SidebarProps & { props?: Readonly<Record<string, unknown>> }) {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const props = viewProps<SidebarProps>(input), account = resolveActiveAccount(s);
  const visible = s.navigation.routes.filter(r => r.navigation);
  const contextual = !!props.onDetailSectionChange;
  const entry = resolveProfileEntry(s, contextual ? props.profileKey ?? null : props.profileKey ?? s.profiles.activeKey);
  const accounts = visible.find(r => r.id === 'accounts');
  const details = s.navigation.routes.some(r => r.id === 'custom.instance-details');
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
  const operationDisabled = !s.window.desktop || !!s.activity || s.settings.saving || s.downloads.active || s.downloads.pending.length > 0 || s.content.pending;

  const currentRoute = s.navigation.routes.find(route => route.id === s.navigation.routeId);
  const mobileNavigation = <div className="mobile-navigation" data-ui-site="ImmersiveSidebarMenu-bar">
    <Menu.Root data-ui-site="ImmersiveSidebarMenu-root">
      <Menu.Trigger className="secondary mobile-navigation-trigger" aria-label={t('responsiveUi.navigation')} data-ui-site="ImmersiveSidebarMenu-trigger"><MenuIcon size={16} aria-hidden="true" data-ui-site="ImmersiveSidebarMenu-icon"/>{t('responsiveUi.navigation')}</Menu.Trigger>
      <Menu.Portal data-ui-site="ImmersiveSidebarMenu-portal">
        <Menu.Positioner side="bottom" align="start" sideOffset={4} className="immersive-navigation-positioner" data-ui-site="ImmersiveSidebarMenu-positioner">
          <Menu.Popup className="immersive-navigation-menu" data-ui-site="ImmersiveSidebarMenu-popup">
            {visible.map(route => { const Icon = routeIcon(route.icon), label = t(route.title, { defaultValue: route.title }); return <UiIdentity key={route.id} namespace="route" value={route.id}>
              <Menu.Item label={label} onClick={() => { if (route.id === 'settings') a.settings.setTab('appearance'); a.navigation.navigate(route.id); }} data-ui-site="ImmersiveSidebarMenu-route">
                {Icon && <Icon size={16} aria-hidden="true" data-ui-site="ImmersiveSidebarMenu-route-icon"/>}<span data-ui-site="ImmersiveSidebarMenu-route-label">{label}</span>
              </Menu.Item>
            </UiIdentity>; })}
            {contextual && entry && <UiIdentity namespace="profile" value={entry.profile.instance_key}>
              <Menu.Separator className="mobile-navigation-separator" data-ui-site="ImmersiveSidebarMenu-separator"/>
              {['overview', 'settings', 'mods', 'resourcepacks', 'shaderpacks', 'saves'].map(section => <UiIdentity key={section} namespace="section" value={section}>
                <Menu.Item label={t(`shellHome.sections.${section}`)} onClick={() => props.onDetailSectionChange?.(section)} data-ui-site="ImmersiveSidebarMenu-section">{t(`shellHome.sections.${section}`)}</Menu.Item>
              </UiIdentity>)}
              <Menu.CheckboxItem checked={s.content.includeSaves} disabled={s.content.pending} onCheckedChange={value => a.content.setIncludeSaves(value)} label={t('content.includeSaves')} data-ui-site="ImmersiveSidebarMenu-include-saves">
                {s.content.includeSaves && <Check size={14} aria-hidden="true" data-ui-site="ImmersiveSidebarMenu-include-check"/>}{t('content.includeSaves')}
              </Menu.CheckboxItem>
              <Menu.Item label={t('content.exportInstance')} disabled={operationDisabled || s.content.selectedProfileKey !== entry.profile.instance_key} onClick={() => void a.content.exportInstance()} data-ui-site="ImmersiveSidebarMenu-export">{t('content.exportInstance')}</Menu.Item>
              {['mods', 'resourcepacks', 'shaderpacks', 'saves'].includes(props.detailSection ?? '') && <Menu.Item label={t('instancePages.openCategory', { category: t(`content.categories.${props.detailSection}`) })} disabled={!s.window.desktop || s.content.pending || s.content.selectedProfileKey !== entry.profile.instance_key || s.content.category !== props.detailSection} onClick={() => void a.content.openDirectory()} data-ui-site="ImmersiveSidebarMenu-folder">{t('instancePages.openCategory', { category: t(`content.categories.${props.detailSection}`) })}</Menu.Item>}
              <Menu.Item label={t('instancePages.relatedTasks')} onClick={() => props.onDetailSectionChange?.('overview')} data-ui-site="ImmersiveSidebarMenu-related">{t('instancePages.relatedTasks')}</Menu.Item>
            </UiIdentity>}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
    <span className="mobile-navigation-label" data-ui-site="ImmersiveSidebarMenu-current">{currentRoute ? t(currentRoute.title, { defaultValue: currentRoute.title }) : t('nav.workspace')}</span>
  </div>;

  if (contextual) return <Fragment>{mobileNavigation}<aside data-ui-site="AppSidebar-context" className="sidebar instance-context-sidebar" aria-label={t('shellHome.instanceSections')}>
    <button data-ui-site="AppSidebar-back" className="text-button" onClick={() => a.navigation.navigate('instances')}>{t('instancePages.back')}</button>
    {entry ? <UiIdentity namespace="profile" value={entry.profile.instance_key}>
      <div data-ui-site="AppSidebar-context-profile" className="sidebar-instance"><div data-ui-site="AppSidebar-context-title"><Box data-ui-site="AppSidebar-context-icon" size={22}/><strong data-ui-site="AppSidebar-context-name" title={entry.profile.name}>{entry.profile.name}</strong></div><small data-ui-site="AppSidebar-context-version">Minecraft {entry.profile.game_version}</small></div>
      <nav data-ui-site="AppSidebar-sections" className="detail-sections" aria-label={t('shellHome.instanceSections')}>{['overview', 'settings', 'mods', 'resourcepacks', 'shaderpacks', 'saves'].map(section => <UiIdentity key={section} namespace="section" value={section}><button data-ui-site="AppSidebar-section" className={`nav-item ${props.detailSection === section ? 'active' : ''}`} onClick={() => props.onDetailSectionChange?.(section)} aria-pressed={props.detailSection === section}>{t(`shellHome.sections.${section}`)}</button></UiIdentity>)}</nav>
      <div data-ui-site="AppSidebar-tools" className="instance-sidebar-tools"><span data-ui-site="AppSidebar-tools-title" className="nav-caption">{t('instancePages.sidebarTools')}</span>
        <label data-ui-site="AppSidebar-include-label" className="instance-checkbox"><input data-ui-site="AppSidebar-include-saves" type="checkbox" checked={s.content.includeSaves} disabled={s.content.pending} onChange={event => a.content.setIncludeSaves(event.target.checked)}/>{t('content.includeSaves')}</label>
        <button data-ui-site="AppSidebar-export" className="text-button" disabled={operationDisabled || s.content.selectedProfileKey !== entry.profile.instance_key} onClick={() => void a.content.exportInstance()}>{t('content.exportInstance')}</button>
        {['mods', 'resourcepacks', 'shaderpacks', 'saves'].includes(props.detailSection ?? '') && <button data-ui-site="AppSidebar-category-folder" className="text-button" disabled={!s.window.desktop || s.content.pending || s.content.selectedProfileKey !== entry.profile.instance_key || s.content.category !== props.detailSection} onClick={() => void a.content.openDirectory()}>{t('instancePages.openCategory', { category: t(`content.categories.${props.detailSection}`) })}</button>}
        <button data-ui-site="AppSidebar-related" className="text-button" onClick={() => props.onDetailSectionChange?.('overview')}>{t('instancePages.relatedTasks')}</button>
        {s.navigation.routes.some(route => route.id === 'logs') && <button data-ui-site="AppSidebar-global-logs" className="text-button" onClick={() => a.navigation.navigate('logs')}>{t('instancePages.globalLogs')}</button>}
      </div>
    </UiIdentity> : <p data-ui-site="AppSidebar-missing" className="instance-note">{t('instancePages.missing')}</p>}
  </aside></Fragment>;
  return <Fragment>{mobileNavigation}<aside data-ui-site="AppSidebar-6" className="sidebar" aria-label={t('nav.workspace')}>

    {accounts && <button data-ui-site="AppSidebar-account" className={`sidebar-account ${s.navigation.routeId === 'accounts' ? 'active' : ''}`} aria-label={t('app.openAccount')} title={`${account.name} · ${t(account.kind === 'microsoft' ? 'auth.microsoftIdentity' : 'common.offlineAccount')}`}
      onClick={() => a.navigation.navigate(accounts.id)}>
      {account.account ? <UiIdentity namespace="account" value={account.account.id}>{avatar}</UiIdentity> : avatar}
      <span data-ui-site="AppSidebar-account-copy" className="sidebar-account-copy"><strong data-ui-site="AppSidebar-name">{account.name}</strong><small data-ui-site="AppSidebar-kind">{t(account.kind === 'microsoft' ? 'auth.microsoftIdentity' : 'common.offlineAccount')}</small></span>
      <ChevronRight data-ui-site="AppSidebar-account-arrow" size={14} />
    </button>}
    {entry && <div data-ui-site="AppSidebar-instance" className="sidebar-instance"><span data-ui-site="AppSidebar-instance-caption" className="nav-caption">{t('shellHome.currentInstance')}</span><div data-ui-site="AppSidebar-instance-copy"><Box data-ui-site="AppSidebar-box" size={20}/><strong data-ui-site="AppSidebar-instance-name">{entry.profile.name}</strong></div><small data-ui-site="AppSidebar-version">Minecraft {entry.profile.game_version}</small>{details && <button data-ui-site="AppSidebar-details" className="text-button" onClick={() => a.navigation.navigate('custom.instance-details', { profileKey: entry.profile.instance_key })}>{t('shellHome.details')}</button>}</div>}
    <div data-ui-site="AppSidebar-caption" className="nav-caption">{t('nav.workspace')}</div>
    <nav data-ui-site="AppSidebar-nav">{visible.filter(r => r.id !== 'accounts' && r.id !== 'settings' && r.id !== 'logs').map(renderRoute)}</nav>
    {s.navigation.routeId === 'instances' && <div data-ui-site="AppSidebar-storage" className="instance-sidebar-storage"><span data-ui-site="AppSidebar-storage-label">{t('instancePages.baseRoot')}</span><code data-ui-site="AppSidebar-storage-path">{entry?.profile.game_directory ?? s.config.value?.settings.game_directory}</code><button data-ui-site="AppSidebar-import" className="text-button" disabled={operationDisabled} onClick={() => a.importDraft.open()}>{t('instances.import')}</button><button data-ui-site="AppSidebar-pack-import" className="text-button" disabled={operationDisabled} onClick={() => void a.content.importPack()}>{t('content.importPack')}</button></div>}
    <div data-ui-site="AppSidebar-bottom" className="sidebar-bottom">{visible.filter(r => r.id === 'settings' || r.id === 'logs').map(renderRoute)}
      <p data-ui-site="AppSidebar-environment" className="sidebar-environment">{t(s.window.desktop ? 'shellHome.desktop' : 'nav.preview')}</p>
    </div>
  </aside></Fragment>;
}
