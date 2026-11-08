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

import { useEffect, useRef } from 'react';
import { Box, Check, Download, Palette, Play, Plus, Settings2 } from 'lucide-react';
export default function Home() {
  const overview = useRef<HTMLElement>(null);

  const launchButton = useRef<HTMLButtonElement>(null), returnLaunchFocus = useRef(false), hadSelection = useRef(false);
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
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
  const perform = () => { returnLaunchFocus.current = !!profile && !!entry?.installed; if (profile) void (entry?.installed ? a.launch.request(profile.instance_key) : a.downloads.install(profile.instance_key)); else if (!s.profiles.items.length) a.profileDraft.openCreate(); else overview.current?.querySelector<HTMLButtonElement>('button[data-profile-choice]')?.focus(); };
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
  const accountContent = <>{account.account ? <UiIdentity namespace="account" value={account.account.id}>{avatar}</UiIdentity> : avatar}<span data-ui-site="Home-account-name">{account.name}</span><small data-ui-site="Home-account-kind">{t(account.kind === 'microsoft' ? 'auth.microsoftIdentity' : 'common.offlineAccount')}</small></>;

  const tasks = s.downloads.tasks;
  const pending = tasks.filter(task => ['queued', 'running', 'cancelling'].includes(task.status));
  const failed = tasks.filter(task => task.status === 'failed');
  const config = s.config.value;
  if (!config) return null;
  return <div data-ui-site="Home-1" className="home-page modern-home">
    <div data-ui-site="Home-workspace" className="home-workspace-grid">
      <section data-ui-site="Home-2" className="current-instance-card" aria-label={t('shellHome.currentInstance')}>
        <div data-ui-site="Home-current-label" className="home-section-label"><Box data-ui-site="Home-6" size={19} />{t('shellHome.currentInstance')}</div>
        <h2 data-ui-site="Home-10">{profile?.name ?? t(s.profiles.items.length ? 'immersive.selectInstance' : 'immersive.firstWorld')}</h2>
        {profile ? <><p data-ui-site="Home-12" className="home-version">Minecraft {entry?.actualInstance?.game_version ?? profile.game_version} · {loader}</p>
          <div data-ui-site="Home-instance-state" className="home-instance-state" data-profile-key={profile.instance_key}><span data-ui-site="Home-status">{t(state)}</span></div></> : <p data-ui-site="Home-empty-description">{t(s.profiles.items.length ? 'immersive.chooseWorld' : 'home.startDescription')}</p>}
        {visible('accounts') ? <button data-ui-site="Home-account" className="home-account" onClick={() => a.navigation.navigate('accounts')}>{accountContent}</button> : <div data-ui-site="Home-account-readonly" className="home-account">{accountContent}</div>}
        <div data-ui-site="Home-actions" className="home-primary-actions">
          <Button ref={launchButton} onKeyDown={event => { if (event.ctrlKey && event.key === 'Enter') returnLaunchFocus.current = true; }} data-ui-site="Home-14" className="primary launch-button" disabled={!!capability && !capability.allowed} onClick={perform}>{profile ? <Play data-ui-site="Home-15" size={17} fill="currentColor"/> : <Plus data-ui-site="Home-16" size={18}/>} {actionTitle}</Button>
          {profile && <button data-ui-site="Home-details" className="secondary" disabled={!registered('custom.instance-details') && !entry?.capabilities.edit.allowed}
            onClick={() => registered('custom.instance-details') ? a.navigation.navigate('custom.instance-details', { profileKey: profile.instance_key }) : a.instanceDraft.open(profile.instance_key)}><Settings2 data-ui-site="Home-settings-icon" size={16}/>{t(registered('custom.instance-details') ? 'shellHome.details' : 'shellHome.instanceSettings')}</button>}
        </div>
        {reason && <p data-ui-site="Home-reason" className="home-action-reason">{reason}</p>}
      </section>
      <section data-ui-site="Home-tasks" className="home-task-card" aria-label={t('shellHome.tasks')}>
        <header data-ui-site="Home-task-header" className="home-section-label"><Download data-ui-site="Home-task-icon" size={19}/><h2 data-ui-site="Home-task-title">{t('shellHome.tasks')}</h2></header>
        <UiView data-ui-site="Home-global-activity" id="component.activity-bar" />
        <div data-ui-site="Home-task-summary" className="home-task-summary"><span data-ui-site="Home-task-pending"><b data-ui-site="Home-task-count">{pending.length}</b>{t('shellHome.activeTasks')}</span><span data-ui-site="Home-task-failed"><b data-ui-site="Home-failed-count">{failed.length}</b>{t('shellHome.failedTasks')}</span></div>
        {!tasks.length && <p data-ui-site="Home-task-empty">{t('shellHome.noTasks')}</p>}
        {tasks.slice(0,3).map(task => <div data-ui-site="Home-task-row" className="home-task-row" key={task.id}><strong data-ui-site="Home-task-name">{task.name}</strong><span data-ui-site="Home-task-status">{t(`shellHome.taskStatus.${task.status}`)}</span></div>)}
        {visible('downloads') && <button data-ui-site="Home-task-link" className="text-button" onClick={() => a.navigation.navigate('downloads')}>{t('shellHome.openTasks')}</button>}
      </section>
    </div>
    <section data-ui-site="Home-overview" className="home-overview" ref={overview} aria-label={t('shellHome.instances')}>
      <header data-ui-site="Home-overview-header"><h2 data-ui-site="Home-overview-title">{t('shellHome.instances')}<span data-ui-site="Home-overview-count">{s.profiles.items.length}</span></h2>
        <div data-ui-site="Home-overview-actions" className="home-shortcuts"><button data-ui-site="Home-create" className="secondary small" onClick={() => a.profileDraft.openCreate()}><Plus data-ui-site="Home-create-icon" size={16}/>{t('app.createInstance')}</button><button data-ui-site="Home-import" className="text-button" disabled={!s.window.desktop} onClick={() => a.importDraft.open()}>{t('shellHome.import')}</button>
          {visible('custom.versions') && <button data-ui-site="Home-versions" className="text-button" onClick={() => a.navigation.navigate('custom.versions')}>{t('home.discoverVersions')}</button>}
          {visible('content') && <button data-ui-site="Home-discover" className="text-button" onClick={() => a.navigation.navigate('content')}>{t('nav.content')}</button>}
        </div>
      </header>
      {s.profiles.items.length ? <div data-ui-site="Home-instance-list" className="home-instance-list">{s.profiles.items.map(item => <UiIdentity key={item.profile.instance_key} namespace="profile" value={item.profile.instance_key}><button data-ui-site="Home-profile-choice" data-profile-choice={item.profile.instance_key}
        className={`home-profile-choice ${item.profile.instance_key === profile?.instance_key ? 'selected' : ''}`} aria-pressed={item.profile.instance_key === profile?.instance_key} onClick={() => void a.profiles.select(item.profile.instance_key)}>
        <Box data-ui-site="Home-profile-icon" size={24}/><span data-ui-site="Home-profile-copy"><strong data-ui-site="Home-profile-name">{item.profile.name}</strong><small data-ui-site="Home-profile-version">{item.profile.game_version} · {item.actualInstance?.loader ?? item.profile.loader}</small></span><span data-ui-site="Home-profile-status">{t(s.launch.profileKey === item.profile.instance_key && phase !== 'idle' ? phase === 'running' ? 'shellHome.running' : phase === 'cancelling' ? 'common.stopping' : 'shellHome.launching' : item.installed ? 'common.installed' : item.actualInstance ? 'loaders.repairRequired' : 'common.notInstalled')}</span>{item.profile.instance_key === profile?.instance_key && <Check data-ui-site="Home-selected" size={16}/>}</button></UiIdentity>)}</div> : <p data-ui-site="Home-empty-list" className="home-empty-list">{t('immersive.emptyDescription')}</p>}
    </section>
    {profile && <div data-ui-site="Home-effective-settings" className="home-effective-settings"><span data-ui-site="Home-memory">{t('home.memory')} <b data-ui-site="Home-memory-value">{((profile.overrides.memory_mb ?? config.settings.memory_mb) / 1024).toFixed(1)} GB</b></span><span data-ui-site="Home-resolution">{t('home.windowSize')} <b data-ui-site="Home-resolution-value">{profile.overrides.resolution_width ?? config.settings.resolution_width} × {profile.overrides.resolution_height ?? config.settings.resolution_height}</b></span></div>}
    {visible('settings') && <button data-ui-site="Home-46" className="home-personalize text-button" onClick={personalize}><Palette data-ui-site="Home-48" size={16}/>{t('home.customize')}</button>}
  </div>;
}
