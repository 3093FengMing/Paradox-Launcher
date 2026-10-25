import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
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
import type { AppConfig, GameProfile, Page } from '../types';

interface Props {
  config: AppConfig;
  active?: GameProfile;
  busy: boolean;
  desktop: boolean;
  backgroundArt: boolean;
  isInstalled: (profile: GameProfile) => boolean;
  renderProfile: (profile: GameProfile) => ReactNode;
  onCreate: () => void;
  onPage: (page: Page) => void;
  onLaunch: (profile: GameProfile) => void;
  onGameSettings: () => void;
}

export default function HomePage(props: Props) {
  const { t } = useTranslation();
  const {
    config,
    active,
    busy,
    desktop,
    backgroundArt,
    isInstalled,
    renderProfile,
    onCreate,
    onPage,
    onLaunch,
    onGameSettings,
  } = props;
  return (
    <div className="home-page">
      <section className={`launch-banner ${backgroundArt ? '' : 'no-art'}`}>
        <div className="banner-illustration" aria-hidden="true" />
        <div className="banner-copy">
          <div className="edition-label">
            <Box size={15} />
            <span>MINECRAFT</span>
            <i />
            <span>JAVA EDITION</span>
          </div>
          <h2>
            {active ? (
              active.name
            ) : (
              <>
                {t('home.headlineFirst')}
                <br />
                {t('home.headlineSecond')}
              </>
            )}
          </h2>
          <p>
            {active
              ? t('home.versionDescription', { version: active.game_version })
              : t('home.startDescription')}
          </p>
          <div className="banner-actions">
            <button
              className="primary launch-button"
              disabled={busy || (!!active && !desktop)}
              onClick={() => (active ? onLaunch(active) : onCreate())}
            >
              {active ? <Play size={17} fill="currentColor" /> : <Plus size={18} />}
              {active
                ? isInstalled(active)
                  ? t('common.launchGame')
                  : t('common.installGame')
                : t('common.createInstance')}
              <ArrowRight size={17} />
            </button>
            {active && (
              <button className="banner-secondary" onClick={() => onPage('instances')}>
                {t('home.manageInstances')}
                <ChevronRight size={15} />
              </button>
            )}
          </div>
        </div>
        <div className="banner-label">
          <span className="status-dot" />
          {active
            ? isInstalled(active)
              ? t('home.ready')
              : t('home.waitingInstall')
            : t('home.adventureReady')}
        </div>
      </section>

      <div className="home-bottom-grid">
        <section className="library-section">
          <div className="section-heading">
            <h2>
              {t('home.library')}
              <span>{config.profiles.length}</span>
            </h2>
            <button className="text-button" onClick={() => onPage('instances')}>
              {t('home.viewAll')}
              <ChevronRight size={15} />
            </button>
          </div>
          {config.profiles.length ? (
            <div className="profile-list">{config.profiles.slice(0, 2).map(renderProfile)}</div>
          ) : (
            <div className="library-empty">
              <div className="empty-cubes">
                <Layers size={30} strokeWidth={1.4} />
              </div>
              <h3>{t('home.emptyTitle')}</h3>
              <p>{t('home.emptyDescription')}</p>
              <button className="text-button" disabled={busy} onClick={onCreate}>
                <Plus size={15} />
                {t('home.createFirst')}
              </button>
            </div>
          )}
          <div className="discovery-row">
            <button className="discovery-button" onClick={() => onPage('downloads')}>
              <div className="discovery-icon">
                <Gamepad2 size={19} />
              </div>
              <div>
                <strong>{t('home.discoverVersions')}</strong>
                <span>{t('home.discoverDescription')}</span>
              </div>
              <ArrowRight size={17} />
            </button>
            <button className="discovery-button" onClick={() => onPage('settings')}>
              <div className="discovery-icon">
                <Palette size={19} />
              </div>
              <div>
                <strong>{t('home.customize')}</strong>
                <span>{t('home.customizeDescription')}</span>
              </div>
              <ArrowRight size={17} />
            </button>
          </div>
        </section>
        <section className="preferences-card">
          <div className="section-heading">
            <h2>{t('home.preferences')}</h2>
            <button
              className="icon-button"
              aria-label={t('home.editPreferences')}
              onClick={onGameSettings}
            >
              <Sparkles size={17} />
            </button>
          </div>
          <button className="preference-row" onClick={onGameSettings}>
            <Cpu size={17} />
            <span>{t('home.memory')}</span>
            <strong>{(config.settings.memory_mb / 1024).toFixed(1)} GB</strong>
            <ChevronRight size={14} />
          </button>
          <button className="preference-row" onClick={onGameSettings}>
            <Box size={17} />
            <span>{t('java.runtime')}</span>
            <strong>
              {config.settings.java_executable ? t('common.manual') : t('common.automatic')}
            </strong>
            <ChevronRight size={14} />
          </button>
          <button className="preference-row" onClick={onGameSettings}>
            <Monitor size={17} />
            <span>{t('home.windowSize')}</span>
            <strong>
              {config.settings.resolution_width} × {config.settings.resolution_height}
            </strong>
            <ChevronRight size={14} />
          </button>
          <button className="account-summary" onClick={() => onPage('accounts')}>
            <div className="avatar">
              {config.settings.offline_username.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <strong>{config.settings.offline_username}</strong>
              <span>
                <UserRound size={11} />
                {t('common.offlineAccount')}
              </span>
            </div>
            <ChevronRight size={16} />
          </button>
        </section>
      </div>
    </div>
  );
}
