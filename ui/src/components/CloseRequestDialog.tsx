import { useTranslation } from 'react-i18next';
import LauncherDialog, { type DialogAppearance } from './LauncherDialog';
import type { CloseRequest } from '../types';

interface Props extends DialogAppearance {
  request: CloseRequest;
  closing: boolean;
  onChoice: (mode: 'stop' | 'background' | 'stay') => void;
}
export default function CloseRequestDialog({ request, closing, onChoice, ...appearance }: Props) {
  const { t } = useTranslation();
  return (
    <LauncherDialog
      {...appearance}
      pending={closing}
      onClose={() => onChoice('stay')}
      title={t('window.close')}
      description={`${request.game_running ? t('closeDialog.gameRunning') : ''}${request.downloads_active ? t('closeDialog.downloadsActive') : ''}${t('closeDialog.description')}`}
    >
      <div className="field">
        <button className="secondary" disabled={closing} onClick={() => onChoice('stay')}>
          {t('closeDialog.stay')}
        </button>
        <button className="secondary" disabled={closing} onClick={() => onChoice('background')}>
          {t('closeDialog.background')}
        </button>
        <button className="primary" disabled={closing} onClick={() => onChoice('stop')}>
          {t('closeDialog.stop')}
        </button>
      </div>
    </LauncherDialog>
  );
}
