import '../styles/common.css';
import { sourceView } from '../lib/view';
import { useTranslation } from 'react-i18next';
import DefaultLauncherDialog from '../dialogs/LauncherDialog';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
function CloseRequestDialog() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions(),
    { request, closing } = snapshot.window;
  const onChoice = (mode: 'stop' | 'background' | 'stay') => {
    void actions.window.respondToClose(mode);
  };
  if (!request) return null;
  return (
    <LauncherDialog
      pending={closing}
      onClose={() => onChoice('stay')}
      title={t('window.close')}
      description={`${request.game_running ? t('closeDialog.gameRunning') : ''}${request.downloads_active ? t('closeDialog.downloadsActive') : ''}${t('closeDialog.description')}`}
      data-ui-site="CloseRequestDialog-1"
    >
      <div className="field" data-ui-site="CloseRequestDialog-2">
        <button
          className="secondary"
          disabled={closing}
          onClick={() => onChoice('stay')}
          data-ui-site="CloseRequestDialog-3"
        >
          {t('closeDialog.stay')}
        </button>
        <button
          className="secondary"
          disabled={closing}
          onClick={() => onChoice('background')}
          data-ui-site="CloseRequestDialog-4"
        >
          {t('closeDialog.background')}
        </button>
        <button
          className="primary"
          disabled={closing}
          onClick={() => onChoice('stop')}
          data-ui-site="CloseRequestDialog-5"
        >
          {t('closeDialog.stop')}
        </button>
      </div>
    </LauncherDialog>
  );
}
export default CloseRequestDialog;
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
