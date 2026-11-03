import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Menu } from '@paradox/ui';
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
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import { translateRuntimeMessage } from '../common/lib/runtime-message';
import './style.css';
export default function Home() {
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions(),
    { t } = useTranslation();
  const [showHint, setShowHint] = useState(true),
    [keyboardNavigation, setKeyboardNavigation] = useState(false);
  const config = snapshot.config.value;
  if (!config) return null;
  const activeEntry = snapshot.profiles.items.find(
      (x) => x.profile.instance_key === snapshot.profiles.activeKey,
    ),
    active = activeEntry?.profile,
    busy = snapshot.activity,
    queueActive = snapshot.downloads.active,
    desktop = snapshot.window.desktop,
    installed = !!activeEntry?.installed;
  const onCreate = () => actions.profileDraft.openCreate(),
    onPage = actions.navigation.navigate,
    onSelect = actions.profiles.select,
    onLaunch = (profile: (typeof config.profiles)[number]) =>
      void (installed
        ? actions.launch.request(profile.instance_key)
        : actions.downloads.install(profile.instance_key)),
    onStop = () => void actions.launch.stop(),
    onCustomize = () => {
      actions.settings.setTab('appearance');
      actions.navigation.navigate('settings');
    };
  const launchActive = snapshot.launch.phase !== 'idle';
  const cancelling = snapshot.launch.phase === 'cancelling';
  const working =
    launchActive ||
    (busy?.action === 'install' &&
      (busy.status === 'started' || busy.status === 'running' || cancelling));
  const blockedByQueue = queueActive && (installed || !active);
  const running = busy?.action === 'launch' && busy.status === 'running';
  const hasProfiles = config.profiles.length > 0;
  const title = working
    ? cancelling
      ? t('common.stopping')
      : running
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

  const primaryAction = () => {
    if (active) onLaunch(active);
    else if (hasProfiles) onPage('instances');
    else onCreate();
  };

  return (
    <section
      data-ui-site="Home-1"
      className="immersive-home"
      aria-label={t('nav.home')}
      onKeyDownCapture={() => setKeyboardNavigation(true)}
      onPointerDownCapture={() => setKeyboardNavigation(false)}
    >
      {showHint && (
        <aside
          data-ui-site="Home-2"
          className="immersive-customize-hint"
          aria-label={t('immersive.customization')}
        >
          <div data-ui-site="Home-3" className="immersive-hint-icon">
            <Palette data-ui-site="Home-4" size={19} strokeWidth={1.7} />
          </div>
          <div data-ui-site="Home-5" className="immersive-hint-copy">
            <h2 data-ui-site="Home-6">{t('immersive.hintTitle')}</h2>
            <p data-ui-site="Home-7">{t('immersive.hintDescription')}</p>
            <button data-ui-site="Home-8" type="button" onClick={onCustomize}>
              {t('immersive.customize')}
              <ChevronRight data-ui-site="Home-9" size={13} />
            </button>
          </div>
          <button
            data-ui-site="Home-10"
            type="button"
            className="immersive-hint-close"
            aria-label={t('immersive.closeHint')}
            onClick={() => setShowHint(false)}
          >
            <X data-ui-site="Home-11" size={16} />
          </button>
        </aside>
      )}

      <div data-ui-site="Home-12" className="immersive-launch-area">
        {(working || blockedByQueue) && (
          <div data-ui-site="Home-13" className="immersive-activity" role="status">
            {running ? (
              <Gamepad2 data-ui-site="Home-14" size={16} />
            ) : (
              <LoaderCircle data-ui-site="Home-15" size={16} className="spin" />
            )}
            <span data-ui-site="Home-16">
              {working && busy
                ? translateRuntimeMessage(busy.message, t)
                : t('immersive.queueBlocked')}
            </span>
            {launchActive && (
              <button
                data-ui-site="Home-17"
                type="button"
                disabled={!snapshot.launch.canStop}
                onClick={onStop}
              >
                <Square data-ui-site="Home-18" size={12} fill="currentColor" />
                {t(
                  cancelling
                    ? 'common.stopping'
                    : running
                      ? 'common.stopGame'
                      : 'common.cancelLaunch',
                )}
              </button>
            )}
          </div>
        )}
        {!desktop && active && (
          <p data-ui-site="Home-19" className="immersive-preview-note">
            {t('immersive.preview')}
          </p>
        )}
        <div data-ui-site="Home-20" className="immersive-launch-split">
          <button
            data-ui-site="Home-21"
            type="button"
            className="immersive-launch-primary"
            disabled={working || blockedByQueue || (!!active && !desktop)}
            onClick={primaryAction}
            aria-label={
              active ? t('immersive.primaryLabel', { action: title, name: active.name }) : title
            }
          >
            {running ? (
              <Gamepad2 data-ui-site="Home-22" size={24} />
            ) : working || blockedByQueue ? (
              <LoaderCircle data-ui-site="Home-23" size={23} className="spin" />
            ) : active ? (
              <Play data-ui-site="Home-24" size={24} fill="currentColor" strokeWidth={1.4} />
            ) : (
              <Plus data-ui-site="Home-25" size={25} strokeWidth={1.8} />
            )}
            <span data-ui-site="Home-26" className="immersive-launch-copy">
              <strong data-ui-site="Home-27">{title}</strong>
              <small data-ui-site="Home-28" title={detail}>
                {detail}
              </small>
            </span>
          </button>
          <Menu.Root data-ui-site="Home-29">
            <Menu.Trigger
              data-ui-site="Home-30"
              className="immersive-launch-select"
              disabled={working || queueActive}
              aria-label={t('immersive.selectInstance')}
              title={t('immersive.selectInstance')}
            >
              <ChevronDown data-ui-site="Home-31" size={20} />
            </Menu.Trigger>
            <Menu.Portal data-ui-site="Home-32">
              <Menu.Positioner
                data-ui-site="Home-33"
                side="top"
                align="end"
                sideOffset={10}
                className={`immersive-menu-positioner ${keyboardNavigation ? 'keyboard-navigation' : ''} ${config.settings.appearance.reduce_motion ? 'reduce-motion' : ''}`}
                data-ui-root
              >
                <Menu.Popup data-ui-site="Home-34" className="immersive-instance-menu">
                  <div data-ui-site="Home-35" className="immersive-menu-heading">
                    {t('immersive.instances')}
                    <span data-ui-site="Home-36">{config.profiles.length}</span>
                  </div>
                  <div data-ui-site="Home-37" className="immersive-menu-instances">
                    {hasProfiles ? (
                      config.profiles.map((profile) => (
                        <Menu.Item
                          data-ui-site="Home-38"
                          key={profile.instance_key}
                          className="immersive-instance-entry"
                          label={profile.name}
                          onClick={() => void onSelect(profile.instance_key)}
                          aria-label={t(
                            profile.instance_key === active?.instance_key
                              ? 'immersive.currentInstanceLabel'
                              : 'immersive.instanceLabel',
                            { name: profile.name, version: profile.game_version },
                          )}
                        >
                          <span data-ui-site="Home-39" className="immersive-menu-instance-icon">
                            <Box data-ui-site="Home-40" size={19} strokeWidth={1.6} />
                          </span>
                          <span data-ui-site="Home-41" className="immersive-menu-instance-copy">
                            <strong data-ui-site="Home-42">{profile.name}</strong>
                            <small data-ui-site="Home-43">
                              {t('immersive.version', { version: profile.game_version })}
                            </small>
                          </span>
                          {profile.instance_key === active?.instance_key && (
                            <Check
                              data-ui-site="Home-44"
                              size={17}
                              className="immersive-menu-check"
                            />
                          )}
                        </Menu.Item>
                      ))
                    ) : (
                      <div data-ui-site="Home-45" className="immersive-menu-empty">
                        {t('immersive.empty')}
                        <br data-ui-site="Home-46" />
                        <span data-ui-site="Home-47">{t('immersive.emptyDescription')}</span>
                      </div>
                    )}
                  </div>
                  <div data-ui-site="Home-48" className="immersive-menu-divider" />
                  <Menu.Item
                    data-ui-site="Home-49"
                    className="immersive-menu-action"
                    label={t('immersive.createNew')}
                    onClick={onCreate}
                  >
                    <Plus data-ui-site="Home-50" size={16} />
                    {t('immersive.createNew')}
                  </Menu.Item>
                  <Menu.Item
                    data-ui-site="Home-51"
                    className="immersive-menu-action"
                    label={t('immersive.manageAll')}
                    onClick={() => onPage('instances')}
                  >
                    <Layers data-ui-site="Home-52" size={16} />
                    {t('immersive.manageAll')}
                    <ChevronRight data-ui-site="Home-53" size={14} />
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        </div>
        <div data-ui-site="Home-54" className="immersive-launch-meta">
          <button
            data-ui-site="Home-55"
            type="button"
            onClick={() => onPage('accounts')}
            className="immersive-account-link"
          >
            <UserRound data-ui-site="Home-56" size={13} />
            <span data-ui-site="Home-57">{config.settings.offline_username}</span>
            <small data-ui-site="Home-58">{t('common.offlineAccount')}</small>
          </button>
          <button
            data-ui-site="Home-59"
            type="button"
            className="immersive-instance-settings"
            onClick={() => onPage('instances')}
            aria-label={t('immersive.manageInstance')}
            title={t('immersive.manageInstance')}
          >
            <Settings2 data-ui-site="Home-60" size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
