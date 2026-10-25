import { useCallback, useEffect, useRef, useState } from 'react';
import { Toaster } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Box, ChevronRight, LoaderCircle, Plus, Settings2 } from 'lucide-react';
import * as api from './api';
import ActivityBar from './components/ActivityBar';
import AppSidebar from './components/AppSidebar';
import HomePage from './components/HomePage';
import ImmersiveHome from './components/ImmersiveHome';
import ProfileCard from './components/ProfileCard';
import ProfileDialog from './components/ProfileDialog';
import WindowBar from './components/WindowBar';
import CloseRequestDialog from './components/CloseRequestDialog';
import DownloadQueue from './components/DownloadQueue';
import ImportInstancesDialog from './components/ImportInstancesDialog';
import InstanceSettingsDialog from './components/InstanceSettingsDialog';
import JavaSettings from './components/JavaSettings';
import RemoveProfileDialog from './components/RemoveProfileDialog';
import AppearancePresets from './components/AppearancePresets';
import { applyLanguagePreference } from './i18n';
import { useCloseRequest } from './hooks/useCloseRequest';
import { useDownloadQueue } from './hooks/useDownloadQueue';
import { useJava } from './hooks/useJava';
import { useLauncher } from './hooks/useLauncher';
import { useSystemTheme } from './hooks/useSystemTheme';
import { appearanceVariables } from './lib/appearance';
import type { ProfileEditor, SettingsTab } from './lib/forms';
import { pageDescriptions, pageNames } from './lib/navigation';
import { profileIsInstalled } from './lib/instances';
import { appVersion } from './lib/version';
import AccountsPage from './pages/AccountsPage';
import DownloadsPage from './pages/DownloadsPage';
import InstancesPage from './pages/InstancesPage';
import LogsPage from './pages/LogsPage';
import SettingsPage from './pages/SettingsPage';
import type { Activity, DownloadTask, GameProfile, Page } from './types';

export default function App() {
  const { t } = useTranslation();
  const launcher = useLauncher();
  const java = useJava(launcher.reportError);
  const { scan: scanInstalled, refreshCatalog } = launcher;
  const { discover: discoverJava } = java;
  const onDownloadComplete = useCallback(
    (task: DownloadTask) => {
      if (task.kind === 'install') void scanInstalled();
      else void discoverJava();
    },
    [scanInstalled, discoverJava],
  );
  const downloads = useDownloadQueue(launcher.reportError, onDownloadComplete);
  const closeRequest = useCloseRequest(launcher.reportError);
  const systemDark = useSystemTheme();
  const [page, setPage] = useState<Page>('home');
  const [search, setSearch] = useState('');
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance');
  const [editor, setEditor] = useState<ProfileEditor | null>(null);
  const [editingInstance, setEditingInstance] = useState<GameProfile | null>(null);
  const [removingInstance, setRemovingInstance] = useState<GameProfile | null>(null);
  const [importing, setImporting] = useState(false);
  const [inputMode, setInputMode] = useState<'pointer' | 'keyboard'>('pointer');
  const contentRef = useRef<HTMLElement>(null);
  const profileSubmitting = useRef(false);
  const language =
    page === 'settings' ? launcher.draft?.language : launcher.bootstrap?.config.settings.language;

  useEffect(() => {
    void applyLanguagePreference(language ?? 'zh-CN').catch(launcher.reportError);
  }, [language, launcher.reportError]);

  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [page]);
  useEffect(() => {
    if (page === 'downloads') void refreshCatalog();
  }, [page, refreshCatalog]);

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
    if (downloads.active) {
      launcher.notify(t('app.downloadsBlockCreate'), true);
      return;
    }
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
        <h1>{t('app.configError')}</h1>
        <p>{launcher.fatal}</p>
        <p>{t('app.configErrorHelp')}</p>
        <button onClick={() => location.reload()}>{t('common.retry')}</button>
      </div>
    );
  }
  if (!launcher.bootstrap || !launcher.draft) {
    return (
      <div className="boot-screen" data-theme="dark">
        <WindowBar onHelp={() => location.reload()} onError={launcher.reportError} />
        <LoaderCircle className="spin" />
        <p>{t('app.loading')}</p>
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
  const dialogAppearance = {
    theme,
    variables,
    reduceMotion: appearance.reduce_motion,
    keyboardNavigation: inputMode === 'keyboard',
  };
  const activeTask = downloads.tasks.find(
    (task) =>
      task.profile_key === active?.instance_key &&
      ['queued', 'running', 'cancelling'].includes(task.status),
  );
  const homeActivity: Activity | null =
    busy ??
    (activeTask
      ? {
          action: 'install',
          status: activeTask.status === 'queued' ? 'started' : 'running',
          message: activeTask.message,
        }
      : null);
  const isInstalled = (profile: GameProfile) =>
    profileIsInstalled(profile, config.settings, launcher.installed);
  const install = async (profile: GameProfile) => {
    if (await downloads.install(profile.instance_key))
      launcher.notify(t('messages.profileQueued', { name: profile.name }));
  };
  const launch = (profile: GameProfile) => {
    if (isInstalled(profile)) {
      if (downloads.active) {
        launcher.notify(t('app.downloadsBlockLaunch'), true);
        return;
      }
      void launcher.runAction('launch', profile);
    } else void install(profile);
  };
  const renderProfile = (profile: GameProfile) => (
    <ProfileCard
      key={profile.instance_key}
      profile={profile}
      activeKey={config.active_profile}
      installed={isInstalled(profile)}
      busy={working}
      queueActive={downloads.active}
      installing={
        downloads.tasks.some(
          (task) =>
            task.profile_key === profile.instance_key &&
            ['queued', 'running', 'cancelling'].includes(task.status),
        ) || downloads.pending.includes(`install:${profile.instance_key}`)
      }
      desktop={api.desktop}
      onInstall={(item) => {
        void install(item);
      }}
      onLaunch={launch}
      onSelect={(key) => {
        void launcher.selectProfile(key);
      }}
      onRename={(item) =>
        setEditor({ name: item.name, version: item.game_version, editKey: item.instance_key })
      }
      onSettings={setEditingInstance}
      onRemove={setRemovingInstance}
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
            {t('app.workspace')} <ChevronRight size={14} />
            <strong>{t(pageNames[page])}</strong>
          </div>
          <div className="topbar-right">
            <span className="version-tag">
              {t('app.earlyAccess')} <b>{appVersion}</b>
            </span>
            <button
              className="avatar"
              aria-label={t('app.openAccount')}
              onClick={() => navigate('accounts')}
            >
              {config.settings.offline_username.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <main ref={contentRef}>
          <div className="page-heading">
            <div>
              <h1>
                {page === 'home'
                  ? t('app.welcome', { name: config.settings.offline_username })
                  : t(pageNames[page])}
              </h1>
              <p>{t(pageDescriptions[page])}</p>
            </div>
            {(page === 'home' || page === 'instances') && (
              <button
                className="secondary"
                disabled={working || downloads.active}
                onClick={() => openCreate()}
              >
                <Plus size={17} />
                {t('app.createInstance')}
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
                busy={homeActivity}
                queueActive={downloads.active}
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
                busy={
                  working || !!activeTask || (downloads.active && (!active || isInstalled(active)))
                }
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
              busy={working || downloads.active}
              renderProfile={renderProfile}
              onSearch={setSearch}
              onScan={() => {
                void launcher.scan();
              }}
              onCreate={() => openCreate()}
              onImport={() => setImporting(true)}
            />
          )}
          {page === 'downloads' && (
            <DownloadsPage
              versions={launcher.versions}
              search={search}
              showSnapshots={config.settings.show_snapshots}
              busy={working || downloads.active}
              catalogBusy={launcher.catalogBusy}
              catalogError={launcher.catalogError}
              catalogSnapshot={launcher.catalogSnapshot}
              queue={
                <DownloadQueue
                  tasks={downloads.tasks}
                  pending={downloads.pending}
                  desktop={api.desktop}
                  gameRunning={busy !== null}
                  onCancel={(id) => {
                    void downloads.cancel(id);
                  }}
                  onRetry={(id) => {
                    void downloads.retry(id);
                  }}
                />
              }
              onSearch={setSearch}
              onRefresh={() => {
                void launcher.refreshCatalog(true);
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
              busy={busy !== null || downloads.active}
              saving={saving}
              onUsernameChange={(value) => launcher.patchSettings('offline_username', value)}
              onSave={() => {
                void launcher.saveAccount();
              }}
              onRoadmap={() => launcher.notify(t('accounts.microsoftRoadmap'))}
            />
          )}
          {page === 'settings' && (
            <SettingsPage
              draft={draft}
              configPath={configPath}
              tab={settingsTab}
              dirty={dirty}
              busy={busy !== null || downloads.active}
              saving={saving}
              onTabChange={setSettingsTab}
              onPatch={launcher.patchSettings}
              onSave={() => {
                void launcher.saveSettings();
              }}
              onReset={launcher.resetSettings}
              onChooseDirectory={() => {
                void api
                  .chooseDirectory(t('app.gameDirectory'))
                  .then((path) => {
                    if (path) launcher.patchSettings('game_directory', path);
                  })
                  .catch(launcher.reportError);
              }}
              presetsPanel={
                <AppearancePresets
                  {...dialogAppearance}
                  presets={config.appearance_presets}
                  currentAppearance={draft.appearance}
                  disabled={working || downloads.active}
                  onSavePreset={launcher.saveAppearancePreset}
                  onApplyPreset={launcher.applyAppearancePreset}
                  onRenamePreset={launcher.renameAppearancePreset}
                  onRemovePreset={launcher.removeAppearancePreset}
                  onImportPreset={launcher.importAppearancePreset}
                />
              }
              javaPanel={
                <JavaSettings
                  discovery={java.discovery}
                  busy={java.busy}
                  desktop={api.desktop}
                  gameRunning={busy !== null}
                  onDiscover={() => {
                    void java.discover();
                  }}
                  onChoose={() => {
                    void java.choose().then((path) => {
                      if (path) launcher.patchSettings('java_executable', path);
                    });
                  }}
                  onInspect={() => {
                    void java.inspect(draft.java_executable);
                  }}
                  onSelect={(path) => launcher.patchSettings('java_executable', path)}
                  onDownload={(major) => {
                    void downloads.java(major);
                  }}
                />
              }
            />
          )}
          {page === 'logs' && (
            <LogsPage logs={launcher.logs} busy={busy !== null} onClear={launcher.clearLogs} />
          )}
          <footer className="app-footer">
            <span>
              Paradox Launcher <i>·</i> v{appVersion}
            </span>
            <button className="text-button" onClick={() => openSettings('advanced')}>
              <Settings2 size={14} />
              {t('app.aboutName')}
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
      {editingInstance && (
        <InstanceSettingsDialog
          key={editingInstance.instance_key}
          {...dialogAppearance}
          profile={editingInstance}
          settings={config.settings}
          saving={saving}
          onClose={() => setEditingInstance(null)}
          onError={launcher.reportError}
          onSave={launcher.updateProfile}
        />
      )}
      {removingInstance && (
        <RemoveProfileDialog
          key={removingInstance.instance_key}
          {...dialogAppearance}
          profile={removingInstance}
          saving={saving}
          onClose={() => setRemovingInstance(null)}
          onRemove={launcher.removeProfile}
        />
      )}
      {importing && (
        <ImportInstancesDialog
          {...dialogAppearance}
          saving={saving}
          blocked={busy !== null || downloads.active}
          onClose={() => setImporting(false)}
          onError={launcher.reportError}
          onImport={launcher.importProfiles}
        />
      )}
      {closeRequest.request && (
        <CloseRequestDialog
          {...dialogAppearance}
          request={closeRequest.request}
          closing={closeRequest.closing}
          onChoice={(mode) => {
            void closeRequest.close(mode);
          }}
        />
      )}
    </div>
  );
}
