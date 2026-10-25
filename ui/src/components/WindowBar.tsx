import { useTranslation } from 'react-i18next';
import { Box, CircleHelp, Minus, Square, X } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { desktop } from '../api';
import { appVersion } from '../lib/version';

interface Props {
  onHelp: () => void;
  onError: (message: string) => void;
}

export default function WindowBar({ onHelp, onError }: Props) {
  const { t } = useTranslation();
  const action = (operation: 'minimize' | 'toggleMaximize' | 'close') => {
    if (!desktop) return;
    const currentWindow = getCurrentWindow();
    void currentWindow[operation]().catch((error: unknown) => onError(String(error)));
  };
  return (
    <header className="window-bar" data-tauri-drag-region>
      <div className="window-title" data-tauri-drag-region>
        <Box size={19} />
        <span data-tauri-drag-region>
          Paradox Launcher <small data-tauri-drag-region>v{appVersion}</small>
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
    </header>
  );
}
