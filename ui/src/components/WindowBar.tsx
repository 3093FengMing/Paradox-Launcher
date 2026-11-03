import { customComponent } from '../customization/Customizable';
import { useTranslation } from 'react-i18next';
import { Box, CircleHelp, Minus, Square, X } from 'lucide-react';
import { useLauncherActions } from '@paradox/launcher';
import { desktop } from '../api';
import { appVersion } from '../lib/version';
import { DragRegion } from '../ui-foundation/index';

interface Props {
  onHelp: () => void;
  onError: (message: string) => void;
}

function WindowBar({ onHelp, onError }: Props) {
  const { t } = useTranslation();
  const { window } = useLauncherActions();
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
    <DragRegion className="window-bar" role="banner">
      <div className="window-title">
        <Box size={19} />
        <span>
          Paradox Launcher <small>v{appVersion}</small>
        </span>
      </div>
      <div className="window-controls">
        <button aria-label={t('window.help')} title={t('window.help')} onClick={onHelp}>
          <CircleHelp size={18} />
        </button>
        <button
          aria-label={t('window.minimize')}
          title={t('window.minimizeTitle')}
          disabled={!desktop}
          onClick={() => action('minimize')}
        >
          <Minus size={18} />
        </button>
        <button
          aria-label={t('window.maximize')}
          title={t('window.maximizeTitle')}
          disabled={!desktop}
          onClick={() => action('toggleMaximize')}
        >
          <Square size={13} />
        </button>
        <button
          className="window-close"
          aria-label={t('window.close')}
          title={t('window.closeTitle')}
          disabled={!desktop}
          onClick={() => action('close')}
        >
          <X size={20} />
        </button>
      </div>
    </DragRegion>
  );
}

const CustomizedWindowBar = customComponent('component.window-bar', WindowBar);
export default CustomizedWindowBar;
