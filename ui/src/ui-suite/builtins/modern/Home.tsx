import { useTranslation } from 'react-i18next';
import { Fragment } from 'react';
import {
  ArrowRight,
  Box,
  ChevronRight,
  Cpu,
  Gamepad2,
  Layers,
  Monitor,
  Palette,
  Play,
  Plus,
  Sparkles,
  UserRound,
} from 'lucide-react';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import { UiView } from '@paradox/ui';
import './style.css';
export default function Home() {
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions(),
    { t } = useTranslation();
  const config = snapshot.config.value;
  if (!config) return null;
  const activeEntry = snapshot.profiles.items.find(
      (x) => x.profile.instance_key === snapshot.profiles.activeKey,
    ),
    active = activeEntry?.profile;
  const busy = !!snapshot.activity || snapshot.downloads.active,
    desktop = snapshot.window.desktop,
    backgroundArt = !!snapshot.appearance.value?.background_art;
  const isInstalled = (profile: (typeof config.profiles)[number]) =>
    !!snapshot.profiles.items.find((x) => x.profile.instance_key === profile.instance_key)
      ?.installed;
  const onCreate = () => actions.profileDraft.openCreate(),
    onPage = actions.navigation.navigate,
    onLaunch = (profile: (typeof config.profiles)[number]) =>
      void (isInstalled(profile)
        ? actions.launch.request(profile.instance_key)
        : actions.downloads.install(profile.instance_key)),
    onGameSettings = () => {
      actions.settings.setTab('game');
      actions.navigation.navigate('settings');
    };
  return (
    <div data-ui-site="Home-1" className="home-page">
      <section data-ui-site="Home-2" className={`launch-banner ${backgroundArt ? '' : 'no-art'}`}>
        <div data-ui-site="Home-3" className="banner-illustration" aria-hidden="true" />
        <div data-ui-site="Home-4" className="banner-copy">
          <div data-ui-site="Home-5" className="edition-label">
            <Box data-ui-site="Home-6" size={15} />
            <span data-ui-site="Home-7">MINECRAFT</span>
            <i data-ui-site="Home-8" />
            <span data-ui-site="Home-9">JAVA EDITION</span>
          </div>
          <h2 data-ui-site="Home-10">
            {active ? (
              active.name
            ) : (
              <Fragment data-ui-site="fragment-1">
                {t('home.headlineFirst')}
                <br data-ui-site="Home-11" />
                {t('home.headlineSecond')}
              </Fragment>
            )}
          </h2>
          <p data-ui-site="Home-12">
            {active
              ? t('home.versionDescription', { version: active.game_version })
              : t('home.startDescription')}
          </p>
          <div data-ui-site="Home-13" className="banner-actions">
            <button
              data-ui-site="Home-14"
              className="primary launch-button"
              disabled={busy || (!!active && !desktop)}
              onClick={() => (active ? onLaunch(active) : onCreate())}
            >
              {active ? (
                <Play data-ui-site="Home-15" size={17} fill="currentColor" />
              ) : (
                <Plus data-ui-site="Home-16" size={18} />
              )}
              {active
                ? isInstalled(active)
                  ? t('common.launchGame')
                  : t('common.installGame')
                : t('common.createInstance')}
              <ArrowRight data-ui-site="Home-17" size={17} />
            </button>
            {active && (
              <button
                data-ui-site="Home-18"
                className="banner-secondary"
                onClick={() => onPage('instances')}
              >
                {t('home.manageInstances')}
                <ChevronRight data-ui-site="Home-19" size={15} />
              </button>
            )}
          </div>
        </div>
        <div data-ui-site="Home-20" className="banner-label">
          <span data-ui-site="Home-21" className="status-dot" />
          {active
            ? isInstalled(active)
              ? t('home.ready')
              : t('home.waitingInstall')
            : t('home.adventureReady')}
        </div>
      </section>

      <div data-ui-site="Home-22" className="home-bottom-grid">
        <section data-ui-site="Home-23" className="library-section">
          <div data-ui-site="Home-24" className="section-heading">
            <h2 data-ui-site="Home-25">
              {t('home.library')}
              <span data-ui-site="Home-26">{config.profiles.length}</span>
            </h2>
            <button
              data-ui-site="Home-27"
              className="text-button"
              onClick={() => onPage('instances')}
            >
              {t('home.viewAll')}
              <ChevronRight data-ui-site="Home-28" size={15} />
            </button>
          </div>
          {config.profiles.length ? (
            <div data-ui-site="Home-29" className="profile-list">
              {config.profiles.slice(0, 2).map((profile) => (
                <UiView
                  data-ui-site="Home-30"
                  key={profile.instance_key}
                  id="component.profile-card"
                  props={{ profileKey: profile.instance_key }}
                />
              ))}
            </div>
          ) : (
            <div data-ui-site="Home-31" className="library-empty">
              <div data-ui-site="Home-32" className="empty-cubes">
                <Layers data-ui-site="Home-33" size={30} strokeWidth={1.4} />
              </div>
              <h3 data-ui-site="Home-34">{t('home.emptyTitle')}</h3>
              <p data-ui-site="Home-35">{t('home.emptyDescription')}</p>
              <button
                data-ui-site="Home-36"
                className="text-button"
                disabled={busy}
                onClick={onCreate}
              >
                <Plus data-ui-site="Home-37" size={15} />
                {t('home.createFirst')}
              </button>
            </div>
          )}
          <div data-ui-site="Home-38" className="discovery-row">
            <button
              data-ui-site="Home-39"
              className="discovery-button"
              onClick={() => onPage('downloads')}
            >
              <div data-ui-site="Home-40" className="discovery-icon">
                <Gamepad2 data-ui-site="Home-41" size={19} />
              </div>
              <div data-ui-site="Home-42">
                <strong data-ui-site="Home-43">{t('home.discoverVersions')}</strong>
                <span data-ui-site="Home-44">{t('home.discoverDescription')}</span>
              </div>
              <ArrowRight data-ui-site="Home-45" size={17} />
            </button>
            <button
              data-ui-site="Home-46"
              className="discovery-button"
              onClick={() => onPage('settings')}
            >
              <div data-ui-site="Home-47" className="discovery-icon">
                <Palette data-ui-site="Home-48" size={19} />
              </div>
              <div data-ui-site="Home-49">
                <strong data-ui-site="Home-50">{t('home.customize')}</strong>
                <span data-ui-site="Home-51">{t('home.customizeDescription')}</span>
              </div>
              <ArrowRight data-ui-site="Home-52" size={17} />
            </button>
          </div>
        </section>
        <section data-ui-site="Home-53" className="preferences-card">
          <div data-ui-site="Home-54" className="section-heading">
            <h2 data-ui-site="Home-55">{t('home.preferences')}</h2>
            <button
              data-ui-site="Home-56"
              className="icon-button"
              aria-label={t('home.editPreferences')}
              onClick={onGameSettings}
            >
              <Sparkles data-ui-site="Home-57" size={17} />
            </button>
          </div>
          <button data-ui-site="Home-58" className="preference-row" onClick={onGameSettings}>
            <Cpu data-ui-site="Home-59" size={17} />
            <span data-ui-site="Home-60">{t('home.memory')}</span>
            <strong data-ui-site="Home-61">
              {(config.settings.memory_mb / 1024).toFixed(1)} GB
            </strong>
            <ChevronRight data-ui-site="Home-62" size={14} />
          </button>
          <button data-ui-site="Home-63" className="preference-row" onClick={onGameSettings}>
            <Box data-ui-site="Home-64" size={17} />
            <span data-ui-site="Home-65">{t('java.runtime')}</span>
            <strong data-ui-site="Home-66">
              {config.settings.java_executable ? t('common.manual') : t('common.automatic')}
            </strong>
            <ChevronRight data-ui-site="Home-67" size={14} />
          </button>
          <button data-ui-site="Home-68" className="preference-row" onClick={onGameSettings}>
            <Monitor data-ui-site="Home-69" size={17} />
            <span data-ui-site="Home-70">{t('home.windowSize')}</span>
            <strong data-ui-site="Home-71">
              {config.settings.resolution_width} × {config.settings.resolution_height}
            </strong>
            <ChevronRight data-ui-site="Home-72" size={14} />
          </button>
          <button
            data-ui-site="Home-73"
            className="account-summary"
            onClick={() => onPage('accounts')}
          >
            <div data-ui-site="Home-74" className="avatar">
              {config.settings.offline_username.slice(0, 1).toUpperCase()}
            </div>
            <div data-ui-site="Home-75">
              <strong data-ui-site="Home-76">{config.settings.offline_username}</strong>
              <span data-ui-site="Home-77">
                <UserRound data-ui-site="Home-78" size={11} />
                {t('common.offlineAccount')}
              </span>
            </div>
            <ChevronRight data-ui-site="Home-79" size={16} />
          </button>
        </section>
      </div>
    </div>
  );
}
