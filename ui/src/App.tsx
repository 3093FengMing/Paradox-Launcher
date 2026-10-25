import { useEffect, useRef, useState } from 'react';
import { Toaster } from 'sonner';
import { Box, ChevronRight, LoaderCircle, Plus, Settings2 } from 'lucide-react';
import * as api from './api';
import ActivityBar from './components/ActivityBar';
import AppSidebar from './components/AppSidebar';
import HomePage from './components/HomePage';
import ImmersiveHome from './components/ImmersiveHome';
import ProfileCard from './components/ProfileCard';
import ProfileDialog from './components/ProfileDialog';
import WindowBar from './components/WindowBar';
import { useLauncher } from './hooks/useLauncher';
import { useSystemTheme } from './hooks/useSystemTheme';
import { appearanceVariables } from './lib/appearance';
import type { ProfileEditor, SettingsTab } from './lib/forms';
import { pageDescriptions, pageNames } from './lib/navigation';
import AccountsPage from './pages/AccountsPage';
import DownloadsPage from './pages/DownloadsPage';
import InstancesPage from './pages/InstancesPage';
import LogsPage from './pages/LogsPage';
import SettingsPage from './pages/SettingsPage';
import type { GameProfile, Page } from './types';

export default function App() {
  const launcher = useLauncher();
  const systemDark = useSystemTheme();
  const [page, setPage] = useState<Page>('home');
  const [search, setSearch] = useState('');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');
  const [editor, setEditor] = useState<ProfileEditor | null>(null);
  const [inputMode, setInputMode] = useState<'pointer' | 'keyboard'>('pointer');
  const profileSubmitting = useRef(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  const navigate = (next: Page) => {
    setPage(next);
    setSearch('');
  };

  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab);
    navigate('settings');
  };

  const openCreate = (version?: string) => {
    if (launcher.busy || launcher.saving) return;
    const defaultVersion =
      launcher.versions.find((item) => item.kind === 'release')?.id ?? '1.21.1';
    setEditor({ name: '', version: version ?? defaultVersion });
  };

  const saveEditor = async () => {
    if (!editor || profileSubmitting.current) return;
    profileSubmitting.current = true;
    try {
      if (await launcher.saveProfile(editor)) {
        setEditor(null);
        navigate('instances');
      }
    } finally {
      profileSubmitting.current = false;
    }
  };

  if (launcher.fatal) {
    return (
      <div className="boot-screen" data-theme="dark">
        <WindowBar onHelp={() => location.reload()} onError={launcher.reportError} />
        <Box size={48} />
        <h1>无法读取启动器配置</h1>
        <p>{launcher.fatal}</p>
        <p>请备份并修复配置文件后重新打开启动器。</p>
        <button onClick={() => location.reload()}>重试</button>
      </div>
    );
  }
  if (!launcher.bootstrap || !launcher.draft) {
    return (
      <div className="boot-screen" data-theme="dark">
        <WindowBar onHelp={() => location.reload()} onError={launcher.reportError} />
        <LoaderCircle className="spin" />
        <p>正在加载 Paradox…</p>
      </div>
    );
  }

  const { config, config_path: configPath } = launcher.bootstrap;
  const { draft, busy, saving } = launcher;
  const active = config.profiles.find((profile) => profile.instance_key === config.active_profile);
  const appearance = page === 'settings' ? draft.appearance : config.settings.appearance;
  const immersive = appearance.interface_style === 'immersive';
  const theme = appearance.theme === 'system' ? (systemDark ? 'dark' : 'light') : appearance.theme;
  const variables = appearanceVariables(appearance, theme);
  const dirty = JSON.stringify(draft) !== JSON.stringify(config.settings);
  const working = busy !== null || saving;
  const isInstalled = (profile: GameProfile) =>
    launcher.installed.some((instance) => instance.instance_key === profile.instance_key);
  const launch = (profile: GameProfile) => {
    void launcher.runAction(isInstalled(profile) ? 'launch' : 'install', profile);
  };
  const renderProfile = (profile: GameProfile) => (
    <ProfileCard
      key={profile.instance_key}
      profile={profile}
      activeKey={config.active_profile}
      installed={isInstalled(profile)}
      busy={working}
      desktop={api.desktop}
      onInstall={(item) => {
        void launcher.runAction('install', item);
      }}
      onLaunch={launch}
      onSelect={(key) => {
        void launcher.selectProfile(key);
      }}
      onRename={(item) =>
        setEditor({ name: item.name, version: item.game_version, editKey: item.instance_key })
      }
    />
  );
  const shellClass = [
    'app-shell',
    immersive ? 'immersive' : 'modern',
    immersive && page === 'home' ? 'immersive-landing' : '',
    appearance.compact_sidebar ? 'compact' : '',
    appearance.reduce_motion ? 'reduce-motion' : '',
    inputMode === 'keyboard' ? 'keyboard-navigation' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={shellClass}
      data-theme={theme}
      style={variables}
      onKeyDownCapture={() => setInputMode('keyboard')}
      onPointerDownCapture={() => setInputMode('pointer')}
    >
      <WindowBar
        onHelp={() => openSettings('appearance')}
        onError={(message) => launcher.notify(message, true)}
      />
      <AppSidebar
        config={config}
        page={page}
        immersive={immersive}
        desktop={api.desktop}
        hasErrors={launcher.logs.some((log) => log.level === 'error')}
        onNavigate={navigate}
      />
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <ChevronRight size={14} />
            <strong>{pageNames[page]}</strong>
          </div>
          <div className="topbar-right">
            <span className="version-tag">
              EARLY ACCESS <b>0.1</b>
            </span>
            <button
              className="avatar"
              aria-label="打开账户管理"
              onClick={() => navigate('accounts')}
            >
              {config.settings.offline_username.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <h1>
                {page === 'home'
                  ? `欢迎回来，${config.settings.offline_username}`
                  : pageNames[page]}
              </h1>
              <p>{pageDescriptions[page]}</p>
            </div>
            {(page === 'home' || page === 'instances') && (
              <button className="secondary" disabled={working} onClick={() => openCreate()}>
                <Plus size={17} />
                创建实例
              </button>
            )}
          </div>
          {busy && (
            <ActivityBar
              activity={busy}
              onStop={() => {
                void launcher.stopGame();
              }}
              onLogs={() => navigate('logs')}
            />
          )}
          {page === 'home' &&
            (immersive ? (
              <ImmersiveHome
                config={config}
                active={active}
                busy={busy}
                desktop={api.desktop}
                installed={!!active && isInstalled(active)}
                onCreate={() => openCreate()}
                onPage={navigate}
                onSelect={(key) => {
                  void launcher.selectProfile(key);
                }}
                onLaunch={launch}
                onStop={() => {
                  void launcher.stopGame();
                }}
                onCustomize={() => openSettings('appearance')}
              />
            ) : (
              <HomePage
                config={config}
                active={active}
                busy={working}
                desktop={api.desktop}
                backgroundArt={appearance.background_art}
                isInstalled={isInstalled}
                renderProfile={renderProfile}
                onCreate={() => openCreate()}
                onPage={navigate}
                onLaunch={launch}
                onGameSettings={() => openSettings('game')}
              />
            ))}
          {page === 'instances' && (
            <InstancesPage
              config={config}
              search={search}
              busy={working}
              renderProfile={renderProfile}
              onSearch={setSearch}
              onScan={() => {
                void launcher.scan();
              }}
              onCreate={() => openCreate()}
            />
          )}
          {page === 'downloads' && (
            <DownloadsPage
              versions={launcher.versions}
              search={search}
              showSnapshots={config.settings.show_snapshots}
              busy={working}
              catalogBusy={launcher.catalogBusy}
              catalogError={launcher.catalogError}
              onSearch={setSearch}
              onRefresh={() => {
                void launcher.refreshCatalog();
              }}
              onCreate={openCreate}
              onSnapshotsChange={(value) => {
                void launcher.setSnapshots(value);
              }}
            />
          )}
          {page === 'accounts' && (
            <AccountsPage
              username={config.settings.offline_username}
              draftUsername={draft.offline_username}
              busy={busy !== null}
              saving={saving}
              onUsernameChange={(value) => launcher.patchSettings('offline_username', value)}
              onSave={() => {
                void launcher.saveAccount();
              }}
              onRoadmap={() =>
                launcher.notify('Microsoft 登录计划在 v0.3 接入，详见项目 ROADMAP.md')
              }
            />
          )}
          {page === 'settings' && (
            <SettingsPage
              draft={draft}
              configPath={configPath}
              tab={settingsTab}
              dirty={dirty}
              busy={busy !== null}
              saving={saving}
              onTabChange={setSettingsTab}
              onPatch={launcher.patchSettings}
              onSave={() => {
                void launcher.saveSettings();
              }}
              onReset={launcher.resetSettings}
            />
          )}
          {page === 'logs' && (
            <LogsPage logs={launcher.logs} busy={busy !== null} onClear={launcher.clearLogs} />
          )}
          <footer className="app-footer">
            <span>
              Paradox Launcher <i>·</i> v0.1.0
            </span>
            <button className="text-button" onClick={() => openSettings('advanced')}>
              <Settings2 size={14} />
              关于与配置
            </button>
          </footer>
        </main>
      </div>
      <Toaster
        theme={theme}
        position="bottom-right"
        closeButton
        duration={5000}
        toastOptions={{
          style: {
            background: 'var(--surface)',
            color: 'var(--text)',
            borderColor: 'var(--border)',
            fontFamily: 'inherit',
          },
        }}
      />
      <ProfileDialog
        editor={editor}
        saving={saving}
        theme={theme}
        variables={variables}
        reduceMotion={appearance.reduce_motion}
        keyboardNavigation={inputMode === 'keyboard'}
        onChange={(patch) =>
          setEditor((previous) => (previous ? { ...previous, ...patch } : previous))
        }
        onClose={() => setEditor(null)}
        onSave={() => {
          void saveEditor();
        }}
      />
    </div>
  );
}
