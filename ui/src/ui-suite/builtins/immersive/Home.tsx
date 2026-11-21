import { useTranslation } from 'react-i18next';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import { UiView, UiIdentity, Button } from '@paradox/ui';
import { resolveActiveAccount, resolveProfileEntry } from '../common/lib/launcher-display';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/home.css';
import './styles/instances.css';
import './styles/host-components.css';
import './style.css';

import { useEffect, useRef, useState } from 'react';
import { Menu } from '@paradox/ui';
import { ArrowUpRight, Box, Check, ChevronDown, ChevronUp, Import, Palette, Play, Plus, Search, Settings2, X } from 'lucide-react';
export default function Home() {
  const [hint, setHint] = useState(true), [menuOpen, setMenuOpen] = useState(false), [search, setSearch] = useState('');
  const [pagination, setPagination] = useState({ key: '', limit: 30 });

  const launchButton = useRef<HTMLButtonElement>(null), returnLaunchFocus = useRef(false), hadSelection = useRef(false);
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t, i18n } = useTranslation();
  const number = (value: number) => new Intl.NumberFormat(i18n.resolvedLanguage).format(value);
  const filtered = s.profiles.items.filter(item => [item.profile.name, item.profile.instance_key, item.actualInstance?.game_version ?? item.profile.game_version, item.actualInstance?.loader ?? item.profile.loader].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const paginationKey = JSON.stringify([search, s.profiles.items.length]);
  const limit = pagination.key === paginationKey ? pagination.limit : 30;
  const menuItems = s.profiles.items.slice(0, 30);
  const entry = resolveProfileEntry(s, s.profiles.activeKey), account = resolveActiveAccount(s);
  const profile = entry?.profile;
  const visible = (id: string) => s.navigation.routes.some(r => r.id === id && r.navigation);
  const registered = (id: string) => s.navigation.routes.some(r => r.id === id);
  const ownLaunch = !!profile && s.launch.profileKey === profile.instance_key && s.launch.phase !== 'idle';
  const ownSelection = !!profile && s.launch.selection?.profileKey === profile.instance_key;
  const phase = s.launch.phase;
  const state = ownLaunch ? (phase === 'running' ? 'shellHome.running' : phase === 'cancelling' ? 'common.stopping' : 'shellHome.launching')
    : ownSelection ? 'shellHome.selectAccount' : entry?.installing ? 'shellHome.installing' : entry?.installed ? 'common.installed' : entry?.actualInstance ? 'loaders.repairRequired' : 'common.notInstalled';
  const capability = entry && (entry.installed ? entry.capabilities.launch : entry.capabilities.install);
  const actionTitle = ownLaunch || ownSelection || entry?.installing ? t(state) : profile ? t(entry?.installed ? 'common.launchGame' : entry?.actualInstance ? 'shellHome.repair' : 'common.installGame') : t(s.profiles.items.length ? 'immersive.selectInstance' : 'immersive.createInstance');
  const reason = capability && !capability.allowed && capability.reason ? t(`shellHome.reasons.${capability.reason}`, { defaultValue: t('shellHome.restricted') }) : null;
  const loader = entry?.actualInstance ? `${entry.actualInstance.loader} ${entry.actualInstance.loader_version ?? ''}` : profile ? `${profile.loader} ${profile.loader_version}` : '';
  const perform = () => { returnLaunchFocus.current = !!profile && !!entry?.installed; if (profile) void (entry?.installed ? a.launch.request(profile.instance_key) : a.downloads.install(profile.instance_key)); else if (!s.profiles.items.length) a.profileDraft.openCreate(); else setMenuOpen(true); };
  useEffect(() => {
    if (s.launch.selection) {
      if (document.activeElement === launchButton.current) returnLaunchFocus.current = true;
      hadSelection.current = true;
    } else if (s.launch.phase !== 'idle') {
      returnLaunchFocus.current = false;
      hadSelection.current = false;
    } else if (hadSelection.current && returnLaunchFocus.current && capability?.allowed) {
      const frame = requestAnimationFrame(() => {
        launchButton.current?.focus();
        returnLaunchFocus.current = false;
        hadSelection.current = false;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [s.launch.selection, s.launch.phase, capability?.allowed]);
  const personalize = () => { a.settings.setTab('appearance'); a.navigation.navigate('settings'); };
  const avatar = <UiView data-ui-site="Home-avatar" id="component.account-avatar" props={{ account: account.account, name: account.name }} />;
  const accountContent = <>{account.account ? <UiIdentity namespace="account" value={account.account.id}>{avatar}</UiIdentity> : avatar}<span className="immersive-account-copy" data-ui-site="Home-account-copy"><strong data-ui-site="Home-account-name" title={account.name}>{account.name}</strong><small data-ui-site="Home-account-kind">{t(account.kind === 'microsoft' ? 'auth.microsoftIdentity' : 'common.offlineAccount')}</small></span></>;

  if (!s.config.value) return null;
  return <section data-ui-site="Home-1" className="immersive-home" aria-label={t('nav.home')}>
    <div data-ui-site="Home-12" className="immersive-launch-area">
      <div data-ui-site="Home-54" className="immersive-launch-meta">
        {registered('accounts') ? <button data-ui-site="Home-55" className="immersive-account-link" onClick={() => a.navigation.navigate('accounts')}>{accountContent}</button> : <div data-ui-site="Home-account-readonly" className="immersive-account-link">{accountContent}</div>}
      </div>
      <UiView data-ui-site="Home-global-activity" id="component.activity-bar" />
      <div data-ui-site="Home-identity" className="immersive-launch-identity">
        <span data-ui-site="Home-current-caption" className="home-current-caption sr-only">{t('shellHome.currentInstance')}</span>
        <h1 data-ui-site="Home-current-name" title={profile?.name}>{profile?.name ?? t(s.profiles.items.length ? 'immersive.chooseWorld' : 'immersive.firstWorld')}</h1>
        {profile && <button data-ui-site="Home-59" className="immersive-instance-settings" aria-label={t('immersive.manageInstance')} title={t('immersive.manageInstance')}
          disabled={!registered('custom.instance-details') && !entry?.capabilities.edit.allowed}
          onClick={() => registered('custom.instance-details') ? a.navigation.navigate('custom.instance-details', { profileKey: profile.instance_key }) : a.instanceDraft.open(profile.instance_key)}><Settings2 data-ui-site="Home-60" size={16} aria-hidden="true" /></button>}
      </div>
      {profile && <div data-ui-site="Home-instance-state" className="home-instance-state" data-profile-key={profile.instance_key}>
        <span data-ui-site="Home-status">{t(state)}</span><small data-ui-site="Home-loader">Minecraft {entry?.actualInstance?.game_version ?? profile.game_version} · {loader}</small>
      </div>}
      {profile && <dl data-ui-site="Home-config" className="immersive-launch-config">
        <div data-ui-site="Home-config-java"><dt data-ui-site="Home-config-java-label">{t('settings.javaExecutable')}</dt><dd data-ui-site="Home-config-java-value" title={profile.overrides.java_executable ?? s.config.value.settings.java_executable}>{(profile.overrides.java_executable ?? s.config.value.settings.java_executable) || t('settingsPages.automaticJava')}</dd></div>
        <div data-ui-site="Home-config-memory"><dt data-ui-site="Home-config-memory-label">{t('settings.maximumMemory')}</dt><dd data-ui-site="Home-config-memory-value">{number(profile.overrides.memory_mb ?? s.config.value.settings.memory_mb)} MB</dd></div>
      </dl>}
      {reason && <p data-ui-site="Home-reason" className="home-action-reason">{reason}</p>}
      <div data-ui-site="Home-20" className="immersive-launch-split">
        <Button ref={launchButton} onKeyDown={event => { if (event.ctrlKey && event.key === 'Enter') returnLaunchFocus.current = true; }} data-ui-site="Home-21" className="immersive-launch-primary" disabled={!!capability && !capability.allowed} onClick={perform}
          aria-label={profile ? t('immersive.primaryLabel', { action: actionTitle, name: profile.name }) : actionTitle}>
          {profile ? <Play data-ui-site="Home-24" size={23} fill="currentColor" /> : <Plus data-ui-site="Home-25" size={24} />}
          <span data-ui-site="Home-26" className="immersive-launch-copy"><strong data-ui-site="Home-27">{actionTitle}</strong><small data-ui-site="Home-28" title={profile?.name}>{profile?.name ?? t(s.profiles.items.length ? 'immersive.chooseWorld' : 'immersive.firstWorld')}</small></span>
        </Button>
        <Menu.Root data-ui-site="Home-29" open={menuOpen} onOpenChange={setMenuOpen}>
          <Menu.Trigger data-ui-site="Home-30" className="immersive-launch-select" aria-label={t('immersive.selectInstance')} title={t('immersive.selectInstance')}><ChevronUp data-ui-site="Home-31" size={20} aria-hidden="true" /></Menu.Trigger>
          <Menu.Portal data-ui-site="Home-32"><Menu.Positioner data-ui-site="Home-33" side="top" align="end" sideOffset={8} className="immersive-menu-positioner immersive-portal" style={{ fontSize: Math.max(13, 14 * (s.appearance.value?.ui_scale ?? 100) / 100) }}>
            <Menu.Popup data-ui-site="Home-34" className="immersive-instance-menu immersive-portal" style={{ fontSize: 'inherit' }}>
              <div data-ui-site="Home-35" className="immersive-menu-heading">{t('immersive.instances')}<span data-ui-site="Home-36">{number(s.profiles.items.length)}</span></div>
              <div data-ui-site="Home-37" className="immersive-menu-instances">
                {menuItems.map(item => <UiIdentity key={item.profile.instance_key} namespace="profile" value={item.profile.instance_key}>
                  <Menu.Item data-ui-site="Home-38" className="immersive-instance-entry" label={item.profile.name} title={item.profile.name}
                    aria-label={t(item.profile.instance_key === profile?.instance_key ? 'immersive.currentInstanceLabel' : 'immersive.instanceLabel', { name: item.profile.name, version: item.profile.game_version })}
                    onClick={() => void a.profiles.select(item.profile.instance_key)} style={{ fontSize: 'inherit' }}>
                    <Box data-ui-site="Home-40" size={20} /><span data-ui-site="Home-41" className="immersive-menu-instance-copy"><strong data-ui-site="Home-42">{item.profile.name}</strong>
                      <small data-ui-site="Home-43">{item.profile.game_version} · {item.actualInstance?.loader ?? item.profile.loader} · {t(item.installed ? 'common.installed' : item.actualInstance ? 'loaders.repairRequired' : 'common.notInstalled')}</small></span>
                    {item.profile.instance_key === profile?.instance_key && <Check data-ui-site="Home-44" size={17} />}
                  </Menu.Item>
                </UiIdentity>)}
                {!s.profiles.items.length && <p data-ui-site="Home-45" className="immersive-menu-empty">{t('immersive.empty')}</p>}
                {s.profiles.items.length > menuItems.length && <p data-ui-site="Home-menu-summary" className="immersive-menu-empty">{t('instances.visibleCount', { shown: number(menuItems.length), total: number(s.profiles.items.length) })}</p>}
              </div>
              <Menu.Separator data-ui-site="Home-48" className="immersive-menu-divider" />
              <Menu.Item data-ui-site="Home-49" className="immersive-menu-action" label={t('immersive.createNew')} onClick={() => a.profileDraft.openCreate()} style={{ fontSize: 'inherit' }}><Plus data-ui-site="Home-50" size={16} />{t('immersive.createNew')}</Menu.Item>
              {visible('instances') && <Menu.Item data-ui-site="Home-51" className="immersive-menu-action" label={t('immersive.manageAll')} onClick={() => a.navigation.navigate('instances')} style={{ fontSize: 'inherit' }}><Box data-ui-site="Home-52" size={16} />{t('immersive.manageAll')}</Menu.Item>}
            </Menu.Popup>
          </Menu.Positioner></Menu.Portal>
        </Menu.Root>
      </div>
      {!profile && !s.profiles.items.length && <div data-ui-site="Home-empty-actions" className="home-empty-actions"><button data-ui-site="Home-import" className="text-button" disabled={!s.window.desktop} onClick={() => a.importDraft.open()}>{t('shellHome.import')}</button>{visible('custom.versions') && <button data-ui-site="Home-versions" className="text-button" onClick={() => a.navigation.navigate('custom.versions')}>{t('home.discoverVersions')}</button>}</div>}
      {hint && visible('settings') && <aside data-ui-site="Home-2" className="immersive-customize-hint" aria-label={t('immersive.customization')}>
      <Palette data-ui-site="Home-4" size={19} /><div data-ui-site="Home-5" className="immersive-hint-copy"><h2 data-ui-site="Home-6">{t('immersive.hintTitle')}</h2>
        <p data-ui-site="Home-7">{t('shellHome.hint')}</p><button data-ui-site="Home-8" onClick={personalize}>{t('immersive.customize')}</button></div>
      <button data-ui-site="Home-10" className="immersive-hint-close" aria-label={t('immersive.closeHint')} onClick={() => setHint(false)}><X data-ui-site="Home-11" size={16} /></button>
    </aside>}
    </div>
    <section data-ui-site="Home-library" className="immersive-home-library" aria-label={t('instancePages.list')}>
      <header data-ui-site="Home-library-heading" className="section-heading">
        <h2 data-ui-site="Home-library-title">{t('immersive.instances')} <span data-ui-site="Home-library-count">{number(s.profiles.items.length)}</span></h2>
        <div data-ui-site="Home-library-actions" className="button-group">
          <button data-ui-site="Home-library-import" className="secondary" disabled={!s.window.desktop || !!s.activity || s.settings.saving || s.downloads.active || s.downloads.pending.length > 0 || s.content.pending} onClick={() => a.importDraft.open()}><Import data-ui-site="Home-library-import-icon" size={16} />{t('instances.import')}</button>
          <button data-ui-site="Home-library-create" className="primary" onClick={() => a.profileDraft.openCreate()}><Plus data-ui-site="Home-library-create-icon" size={16} />{t('common.createInstance')}</button>
        </div>
      </header>
      <label data-ui-site="Home-library-search-label" className="instances-search home-library-search">
        <Search data-ui-site="Home-library-search-icon" size={17} aria-hidden="true" />
        <input data-ui-site="Home-library-search" value={search} onChange={event => setSearch(event.target.value)} aria-label={t('instances.search')} placeholder={t('instances.searchPlaceholder')} />
      </label>
      <div data-ui-site="Home-library-list" className="immersive-home-list">
        {filtered.slice(0, limit).map(item => {
          const key = item.profile.instance_key, current = key === s.profiles.activeKey;
          const itemState = s.launch.profileKey === key && s.launch.phase !== 'idle' ? s.launch.phase === 'running' ? 'instancePages.running' : s.launch.phase === 'cancelling' ? 'common.stopping' : 'instancePages.launching'
            : s.launch.selection?.profileKey === key ? 'instancePages.selectAccount' : item.installing ? 'instancePages.taskActive' : item.installed ? 'common.installed' : item.actualInstance ? 'instancePages.filterStatus.repair' : 'common.notInstalled';
          return <UiIdentity key={key} namespace="profile" value={key}>
            <article data-ui-site="Home-library-row" className="immersive-home-row" data-current={current} data-profile-key={key}>
              <button data-ui-site="Home-library-select" className="home-instance-select" title={item.profile.name} aria-pressed={current}
                aria-label={t(current ? 'immersive.currentInstanceLabel' : 'immersive.instanceLabel', { name: item.profile.name, version: item.actualInstance?.game_version ?? item.profile.game_version })}
                onClick={() => void a.profiles.select(key)}>
                <Box data-ui-site="Home-library-row-icon" size={22} aria-hidden="true" />
                <span data-ui-site="Home-library-row-copy" className="home-instance-copy">
                  <span data-ui-site="Home-library-row-name-line" className="home-instance-name-line"><strong data-ui-site="Home-library-row-name">{item.profile.name}</strong>{current && <small data-ui-site="Home-library-current" className="home-current-marker">{t('instancePages.current')}</small>}</span>
                  <small data-ui-site="Home-library-row-version">Minecraft {item.actualInstance?.game_version ?? item.profile.game_version} · {item.actualInstance?.loader ?? item.profile.loader}</small>
                </span>
              </button>
              <span data-ui-site="Home-library-row-status" className="home-row-status">{current && <Check data-ui-site="Home-library-row-check" size={14} aria-hidden="true" />}{t(itemState)}</span>
              <button data-ui-site="Home-library-details" className="text-button home-row-details" disabled={!registered('custom.instance-details')} aria-label={t('instancePages.detailsFor', { name: item.profile.name })} onClick={() => a.navigation.navigate('custom.instance-details', { profileKey: key })}><ArrowUpRight data-ui-site="Home-library-details-icon" size={16} aria-hidden="true" /><span data-ui-site="Home-library-details-label">{t('shellHome.details')}</span></button>
            </article>
          </UiIdentity>;
        })}
        {!s.profiles.items.length && <div data-ui-site="Home-library-empty" className="instance-message"><h3 data-ui-site="Home-library-empty-title">{t('instances.emptyTitle')}</h3><p data-ui-site="Home-library-empty-copy">{t('instances.emptyDescription')}</p></div>}
        {!!s.profiles.items.length && !filtered.length && <div data-ui-site="Home-library-no-matches" className="instance-message"><h3 data-ui-site="Home-no-matches-title">{t('instances.noMatches')}</h3><p data-ui-site="Home-no-matches-description">{t('instances.trySearch')}</p><button data-ui-site="Home-clear-search" className="secondary" onClick={() => setSearch('')}>{t('instances.clearSearch')}</button></div>}
      </div>
      {!!filtered.length && <div data-ui-site="Home-pagination" className="home-library-pagination"><span data-ui-site="Home-shown" role="status">{t('instances.visibleCount', { shown: number(Math.min(limit, filtered.length)), total: number(filtered.length) })}</span>{filtered.length > limit && <button data-ui-site="Home-more" className="secondary" onClick={() => setPagination({ key: paginationKey, limit: limit + 30 })}><ChevronDown size={16} aria-hidden="true" data-ui-site="Home-more-icon"/>{t('instances.loadMore')}</button>}</div>}
      {visible('instances') && <footer data-ui-site="Home-library-footer" className="home-library-footer"><button data-ui-site="Home-library-manage" className="text-button" onClick={() => a.navigation.navigate('instances')}>{t('immersive.manageAll')}<ArrowUpRight data-ui-site="Home-library-manage-icon" size={16} aria-hidden="true" /></button></footer>}
    </section>
  </section>;
}
