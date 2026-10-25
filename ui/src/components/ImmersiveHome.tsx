import { useTranslation } from 'react-i18next';
import { useState, type CSSProperties } from 'react';
import { Menu } from '@base-ui/react/menu';
import {
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Gamepad2,
  Layers,
  LoaderCircle,
  Palette,
  Play,
  Plus,
  Settings2,
  Square,
  UserRound,
  X,
} from 'lucide-react';
import { readableAccent } from '../colors';
import type { Activity, AppConfig, GameProfile, Page } from '../types';
import { translateRuntimeMessage } from '../i18n';

interface Props {
  config: AppConfig;
  active?: GameProfile;
  busy: Activity | null;
  queueActive: boolean;
  desktop: boolean;
  installed: boolean;
  onCreate: () => void;
  onPage: (page: Page) => void;
  onSelect: (key: string) => void;
  onLaunch: (profile: GameProfile) => void;
  onStop: () => void;
  onCustomize: () => void;
}

export default function ImmersiveHome({
  config,
  active,
  busy,
  queueActive,
  desktop,
  installed,
  onCreate,
  onPage,
  onSelect,
  onLaunch,
  onStop,
  onCustomize,
}: Props) {
  const { t } = useTranslation();
  const [showHint, setShowHint] = useState(true);
  const [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const working = busy?.status === 'started' || busy?.status === 'running';
  const blockedByQueue = queueActive && (installed || !active);
  const running = busy?.action === 'launch' && busy.status === 'running';
  const hasProfiles = config.profiles.length > 0;
  const title = working
    ? running
      ? t('immersive.running')
      : busy?.action === 'install'
        ? t('immersive.preparing')
        : t('immersive.launching')
    : blockedByQueue
      ? t('immersive.waitingDownload')
      : active
        ? installed
          ? t('common.launchGame')
          : t('common.installGame')
        : hasProfiles
          ? t('immersive.selectInstance')
          : t('immersive.createInstance');
  const detail = active
    ? `${active.name} · ${active.game_version}`
    : hasProfiles
      ? t('immersive.chooseWorld')
      : t('immersive.firstWorld');
  const menuVariables = {
    '--menu-accent': readableAccent(config.settings.appearance.accent_color, 'dark'),
    '--menu-radius': `${config.settings.appearance.border_radius}px`,
    fontSize: `${config.settings.appearance.ui_scale}%`,
  } as CSSProperties;

  const primaryAction = () => {
    if (active) onLaunch(active);
    else if (hasProfiles) onPage('instances');
    else onCreate();
  };

  return (
    <section
      className="immersive-home"
      aria-label={t('nav.home')}
      onKeyDownCapture={() => setKeyboardNavigation(true)}
      onPointerDownCapture={() => setKeyboardNavigation(false)}
    >
      {showHint && (
        <aside className="immersive-customize-hint" aria-label={t('immersive.customization')}>
          <div className="immersive-hint-icon">
            <Palette size={19} strokeWidth={1.7} />
          </div>
          <div className="immersive-hint-copy">
            <h2>{t('immersive.hintTitle')}</h2>
            <p>{t('immersive.hintDescription')}</p>
            <button type="button" onClick={onCustomize}>
              {t('immersive.customize')}
              <ChevronRight size={13} />
            </button>
          </div>
          <button
            type="button"
            className="immersive-hint-close"
            aria-label={t('immersive.closeHint')}
            onClick={() => setShowHint(false)}
          >
            <X size={16} />
          </button>
        </aside>
      )}

      <div className="immersive-launch-area">
        {(working || blockedByQueue) && (
          <div className="immersive-activity" role="status">
            {running ? <Gamepad2 size={16} /> : <LoaderCircle size={16} className="spin" />}
            <span>
              {working && busy
                ? translateRuntimeMessage(busy.message)
                : t('immersive.queueBlocked')}
            </span>
            {running && (
              <button type="button" onClick={onStop}>
                <Square size={12} fill="currentColor" />
                {t('common.stopGame')}
              </button>
            )}
          </div>
        )}
        {!desktop && active && <p className="immersive-preview-note">{t('immersive.preview')}</p>}
        <div className="immersive-launch-split">
          <button
            type="button"
            className="immersive-launch-primary"
            disabled={working || blockedByQueue || (!!active && !desktop)}
            onClick={primaryAction}
            aria-label={
              active ? t('immersive.primaryLabel', { action: title, name: active.name }) : title
            }
          >
            {running ? (
              <Gamepad2 size={24} />
            ) : working || blockedByQueue ? (
              <LoaderCircle size={23} className="spin" />
            ) : active ? (
              <Play size={24} fill="currentColor" strokeWidth={1.4} />
            ) : (
              <Plus size={25} strokeWidth={1.8} />
            )}
            <span className="immersive-launch-copy">
              <strong>{title}</strong>
              <small title={detail}>{detail}</small>
            </span>
          </button>
          <Menu.Root>
            <Menu.Trigger
              className="immersive-launch-select"
              disabled={working || queueActive}
              aria-label={t('immersive.selectInstance')}
              title={t('immersive.selectInstance')}
            >
              <ChevronDown size={20} />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner
                side="top"
                align="end"
                sideOffset={10}
                className={`immersive-menu-positioner ${keyboardNavigation ? 'keyboard-navigation' : ''} ${config.settings.appearance.reduce_motion ? 'reduce-motion' : ''}`}
                style={menuVariables}
              >
                <Menu.Popup className="immersive-instance-menu">
                  <div className="immersive-menu-heading">
                    {t('immersive.instances')}
                    <span>{config.profiles.length}</span>
                  </div>
                  <div className="immersive-menu-instances">
                    {hasProfiles ? (
                      config.profiles.map((profile) => (
                        <Menu.Item
                          key={profile.instance_key}
                          className="immersive-instance-entry"
                          label={profile.name}
                          onClick={() => onSelect(profile.instance_key)}
                          aria-label={t(
                            profile.instance_key === active?.instance_key
                              ? 'immersive.currentInstanceLabel'
                              : 'immersive.instanceLabel',
                            { name: profile.name, version: profile.game_version },
                          )}
                        >
                          <span className="immersive-menu-instance-icon">
                            <Box size={19} strokeWidth={1.6} />
                          </span>
                          <span className="immersive-menu-instance-copy">
                            <strong>{profile.name}</strong>
                            <small>
                              {t('immersive.version', { version: profile.game_version })}
                            </small>
                          </span>
                          {profile.instance_key === active?.instance_key && (
                            <Check size={17} className="immersive-menu-check" />
                          )}
                        </Menu.Item>
                      ))
                    ) : (
                      <div className="immersive-menu-empty">
                        {t('immersive.empty')}
                        <br />
                        <span>{t('immersive.emptyDescription')}</span>
                      </div>
                    )}
                  </div>
                  <div className="immersive-menu-divider" />
                  <Menu.Item
                    className="immersive-menu-action"
                    label={t('immersive.createNew')}
                    onClick={onCreate}
                  >
                    <Plus size={16} />
                    {t('immersive.createNew')}
                  </Menu.Item>
                  <Menu.Item
                    className="immersive-menu-action"
                    label={t('immersive.manageAll')}
                    onClick={() => onPage('instances')}
                  >
                    <Layers size={16} />
                    {t('immersive.manageAll')}
                    <ChevronRight size={14} />
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
        <div className="immersive-launch-meta">
          <button
            type="button"
            onClick={() => onPage('accounts')}
            className="immersive-account-link"
          >
            <UserRound size={13} />
            <span>{config.settings.offline_username}</span>
            <small>{t('common.offlineAccount')}</small>
          </button>
          <button
            type="button"
            className="immersive-instance-settings"
            onClick={() => onPage('instances')}
            aria-label={t('immersive.manageInstance')}
            title={t('immersive.manageInstance')}
          >
            <Settings2 size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
