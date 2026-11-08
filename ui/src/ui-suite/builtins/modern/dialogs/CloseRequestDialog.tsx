import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { sourceView } from '../../common/lib/view';
import DefaultLauncherDialog from './LauncherDialog';
import '../styles/business-dialogs.css';
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
export default function CloseRequestDialog() {
  const s = useLauncherSnapshot(), a = useLauncherActions().window, { t } = useTranslation(), safe = useRef<HTMLButtonElement>(null);
  const { request, closing } = s.window;
  const choice = (mode: 'stop' | 'background' | 'stay') => { if (!closing) void a.respondToClose(mode); };
  if (!request) return null;
  return <LauncherDialog title={t('window.close')} description={t('closeDialog.description')} pending={closing} onClose={() => choice('stay')} initialFocus={safe} data-ui-site="ModernClose-shell">
    <div className="business-dialog-form" data-ui-site="ModernClose-content">
      {(request.game_running || request.downloads_active) && <section className="dialog-section dialog-close-state" data-ui-site="ModernClose-state">{request.game_running && <p data-ui-site="ModernClose-game">{t('closeDialog.gameRunning')}</p>}{request.downloads_active && <p data-ui-site="ModernClose-downloads">{t('closeDialog.downloadsActive')}</p>}</section>}
      <div className="dialog-close-choices" data-ui-site="ModernClose-choices"><button ref={safe} type="button" className="secondary" disabled={closing} onClick={() => choice('stay')} data-ui-site="ModernClose-stay">{t('closeDialog.stay')}</button><button type="button" className="secondary" disabled={closing} onClick={() => choice('background')} data-ui-site="ModernClose-background">{t('closeDialog.background')}</button><button type="button" className="primary" disabled={closing} onClick={() => choice('stop')} data-ui-site="ModernClose-stop">{t('closeDialog.stop')}</button></div>
    </div>
  </LauncherDialog>;
}
