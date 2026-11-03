import '../styles/common.css';
import { useTranslation } from 'react-i18next';
import { Box, CircleHelp, Minus, Square, X } from 'lucide-react';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { appVersion } from '../lib/version';
import { DragRegion } from '@paradox/ui';
function WindowBar() {
  const { t } = useTranslation();
  const actions = useLauncherActions(),
    snapshot = useLauncherSnapshot(),
    window = actions.window,
    desktop = snapshot.window.desktop;
  const onHelp = () => {
      actions.settings.setTab('appearance');
      actions.navigation.navigate('settings');
    },
    onError = (message: string) => actions.notifications.publish('error', message);
  const action = (operation: 'minimize' | 'toggleMaximize' | 'close') => {
    if (!desktop) return;
    const perform =
      operation === 'minimize'
        ? window.minimize
        : operation === 'toggleMaximize'
          ? window.maximize
          : window.requestClose;
    void perform().catch((error: unknown) => onError(String(error)));
  };
  return (
    <DragRegion className="window-bar" role="banner" data-ui-site="WindowBar-1">
      <div className="window-title" data-ui-site="WindowBar-2">
        <Box size={19} data-ui-site="WindowBar-3" />
        <span data-ui-site="WindowBar-4">
          Paradox Launcher <small data-ui-site="WindowBar-5">v{appVersion}</small>
        </span>
      </div>
      <div className="window-controls" data-ui-site="WindowBar-6">
        <button
          aria-label={t('window.help')}
          title={t('window.help')}
          onClick={onHelp}
          data-ui-site="WindowBar-7"
        >
          <CircleHelp size={18} data-ui-site="WindowBar-8" />
        </button>
        <button
          aria-label={t('window.minimize')}
          title={t('window.minimizeTitle')}
          disabled={!desktop}
          onClick={() => action('minimize')}
          data-ui-site="WindowBar-9"
        >
          <Minus size={18} data-ui-site="WindowBar-10" />
        </button>
        <button
          aria-label={t('window.maximize')}
          title={t('window.maximizeTitle')}
          disabled={!desktop}
          onClick={() => action('toggleMaximize')}
          data-ui-site="WindowBar-11"
        >
          <Square size={13} data-ui-site="WindowBar-12" />
        </button>
        <button
          className="window-close"
          aria-label={t('window.close')}
          title={t('window.closeTitle')}
          disabled={!desktop}
          onClick={() => action('close')}
          data-ui-site="WindowBar-13"
        >
          <X size={20} data-ui-site="WindowBar-14" />
        </button>
      </div>
    </DragRegion>
  );
}
export default WindowBar;
