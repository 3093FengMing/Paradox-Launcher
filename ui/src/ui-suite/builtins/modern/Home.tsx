import { useTranslation } from 'react-i18next';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import { UiView, UiIdentity, Button } from '@paradox/ui';
import { resolveActiveAccount, resolveProfileEntry } from '../common/lib/launcher-display';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/pages.css';
import './styles/home.css';
import './styles/host-components.css';
import './style.css';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Box, Check, Import, Palette, Play, Plus, Search, Settings2, X } from 'lucide-react';
export default function Home() {
  const overview = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(''), [visibleCount, setVisibleCount] = useState(30);

  const launchButton = useRef<HTMLButtonElement>(null), returnLaunchFocus = useRef(false), hadSelection = useRef(false);
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t, i18n } = useTranslation();
  const formatCount = (value: number) => new Intl.NumberFormat(i18n.language).format(value);
  const matches = s.profiles.items.filter(item => [item.profile.name, item.profile.instance_key, item.actualInstance?.game_version ?? item.profile.game_version, item.actualInstance?.loader ?? item.profile.loader].join(' ').toLocaleLowerCase(i18n.language).includes(search.trim().toLocaleLowerCase(i18n.language)));
  const shown = matches.slice(0, visibleCount);
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
  const perform = () => { returnLaunchFocus.current = !!profile && !!entry?.installed; if (profile) void (entry?.installed ? a.launch.request(profile.instance_key) : a.downloads.install(profile.instance_key)); else if (!s.profiles.items.length) a.profileDraft.openCreate(); else (overview.current?.querySelector<HTMLButtonElement>('button[data-profile-choice]') ?? searchInput.current)?.focus(); };
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
  const accountContent = <>{account.account ? <UiIdentity namespace="account" value={account.account.id}>{avatar}</UiIdentity> : avatar}<span className="home-account-copy" data-ui-site="Home-account-copy"><strong data-ui-site="Home-account-name" title={account.name} dir="auto">{account.name}</strong><small data-ui-site="Home-account-kind">{t(account.kind === 'microsoft' ? 'auth.microsoftIdentity' : 'common.offlineAccount')}</small></span></>;

  if (!s.config.value) return null;
  return <div data-ui-site="Home-1" className="home-page modern-home">
    <UiView data-ui-site="Home-global-activity" id="component.activity-bar" />
    <div data-ui-site="Home-workspace" className="home-workspace-grid">
      <section data-ui-site="Home-2" className="current-instance-card" aria-label={t('shellHome.currentInstance')}>
        {registered('accounts') ? <button data-ui-site="Home-account" className="home-account" onClick={() => a.navigation.navigate('accounts')}>{accountContent}<ArrowUpRight size={16} aria-hidden="true" data-ui-site="Home-account-arrow"/></button> : <div data-ui-site="Home-account-readonly" className="home-account">{accountContent}</div>}
        <h2 data-ui-site="Home-10" dir="auto">{profile?.name ?? t(s.profiles.items.length ? 'immersive.selectInstance' : 'immersive.firstWorld')}</h2>
        <div data-ui-site="Home-current-label" className="home-section-label"><Box data-ui-site="Home-6" size={20} aria-hidden="true"/><span>{t('shellHome.currentInstance')}</span></div>
        {profile ? <><p data-ui-site="Home-12" className="home-version">Minecraft {entry?.actualInstance?.game_version ?? profile.game_version} · {loader}</p>
          <div data-ui-site="Home-instance-state" className="home-instance-state" data-profile-key={profile.instance_key}><span data-ui-site="Home-status">{t(state)}</span></div></> : <p data-ui-site="Home-empty-description">{t(s.profiles.items.length ? 'immersive.chooseWorld' : 'home.startDescription')}</p>}
        <div data-ui-site="Home-actions" className="home-primary-actions">
          <Button ref={launchButton} onKeyDown={event => { if (event.ctrlKey && event.key === 'Enter') returnLaunchFocus.current = true; }} data-ui-site="Home-14" className="primary launch-button" disabled={!!capability && !capability.allowed} onClick={perform}>{profile ? <Play data-ui-site="Home-15" size={17} fill="currentColor" aria-hidden="true"/> : <Plus data-ui-site="Home-16" size={18} aria-hidden="true"/>} {actionTitle}</Button>
          {profile && <button data-ui-site="Home-details" className="secondary" disabled={!registered('custom.instance-details') && !entry?.capabilities.edit.allowed}
            onClick={() => registered('custom.instance-details') ? a.navigation.navigate('custom.instance-details', { profileKey: profile.instance_key }) : a.instanceDraft.open(profile.instance_key)}><Settings2 data-ui-site="Home-settings-icon" size={16} aria-hidden="true"/>{t(registered('custom.instance-details') ? 'shellHome.details' : 'shellHome.instanceSettings')}</button>}
        </div>
        {reason && <p data-ui-site="Home-reason" className="home-action-reason">{reason}</p>}
      </section>
    <section data-ui-site="Home-overview" className="home-overview" ref={overview} aria-label={t('shellHome.instances')}>
      <header data-ui-site="Home-overview-header"><h2 data-ui-site="Home-overview-title">{t('shellHome.instances')}<span data-ui-site="Home-overview-count">{formatCount(s.profiles.items.length)}</span></h2>
        <div data-ui-site="Home-overview-actions" className="home-shortcuts"><button data-ui-site="Home-create" className="secondary small" onClick={() => a.profileDraft.openCreate()}><Plus data-ui-site="Home-create-icon" size={16} aria-hidden="true"/>{t('app.createInstance')}</button><button data-ui-site="Home-import" className="text-button" disabled={!s.window.desktop} onClick={() => a.importDraft.open()}><Import size={16} aria-hidden="true" data-ui-site="Home-import-icon"/>{t('shellHome.import')}</button>
        </div>
      </header>
      {!!s.profiles.items.length && <div data-ui-site="Home-search" className="home-library-search"><Search size={17} aria-hidden="true" data-ui-site="Home-search-icon"/><input ref={searchInput} type="search" value={search} onChange={event => { setSearch(event.target.value); setVisibleCount(30); }} placeholder={t('instances.searchPlaceholder')} aria-label={t('instances.search')} data-ui-site="Home-search-input"/>{search && <button className="text-button" onClick={() => { setSearch(''); setVisibleCount(30); searchInput.current?.focus(); }} aria-label={t('instances.clearSearch')} data-ui-site="Home-search-clear"><X size={16} aria-hidden="true" data-ui-site="Home-search-clear-icon"/></button>}</div>}
      {s.profiles.items.length ? <div data-ui-site="Home-instance-list" className="home-instance-list">{shown.map(item => <UiIdentity key={item.profile.instance_key} namespace="profile" value={item.profile.instance_key}><button data-ui-site="Home-profile-choice" data-profile-choice={item.profile.instance_key}
        className={`home-profile-choice ${item.profile.instance_key === profile?.instance_key ? 'selected' : ''}`} aria-pressed={item.profile.instance_key === profile?.instance_key} onClick={() => void a.profiles.select(item.profile.instance_key)}>
        <Box data-ui-site="Home-profile-icon" size={24} aria-hidden="true"/><span data-ui-site="Home-profile-copy"><strong data-ui-site="Home-profile-name" title={item.profile.name} dir="auto">{item.profile.name}</strong><small data-ui-site="Home-profile-version">{item.actualInstance?.game_version ?? item.profile.game_version} · {item.actualInstance?.loader ?? item.profile.loader}</small></span><span data-ui-site="Home-profile-status">{t(s.launch.profileKey === item.profile.instance_key && phase !== 'idle' ? phase === 'running' ? 'shellHome.running' : phase === 'cancelling' ? 'common.stopping' : 'shellHome.launching' : item.installing ? 'shellHome.installing' : item.installed ? 'common.installed' : item.actualInstance ? 'loaders.repairRequired' : 'common.notInstalled')}</span>{item.profile.instance_key === profile?.instance_key && <Check data-ui-site="Home-selected" size={16} aria-hidden="true"/>}</button></UiIdentity>)}
        {!matches.length && <div className="home-empty-list" data-ui-site="Home-no-matches"><h3 data-ui-site="Home-no-matches-title">{t('instances.noMatches')}</h3><p data-ui-site="Home-no-matches-copy">{t('instances.trySearch')}</p></div>}
      </div> : <p data-ui-site="Home-empty-list" className="home-empty-list">{t('immersive.emptyDescription')}</p>}
      {!!s.profiles.items.length && <footer className="home-library-footer" data-ui-site="Home-library-footer"><span data-ui-site="Home-library-count" aria-live="polite">{t('instances.visibleCount', { shown: formatCount(shown.length), total: formatCount(matches.length) })}</span>{shown.length < matches.length && <button className="secondary small" onClick={() => setVisibleCount(count => count + 30)} data-ui-site="Home-load-more">{t('instances.loadMore')}</button>}{visible('instances') && <button className="text-button" onClick={() => a.navigation.navigate('instances')} data-ui-site="Home-manage">{t('immersive.manageAll')}<ArrowUpRight size={15} aria-hidden="true" data-ui-site="Home-manage-icon"/></button>}</footer>}
    </section>
    </div>
    {visible('settings') && <button data-ui-site="Home-46" className="home-personalize text-button" onClick={personalize}><Palette data-ui-site="Home-48" size={16} aria-hidden="true"/>{t('home.customize')}</button>}
  </div>;
}
