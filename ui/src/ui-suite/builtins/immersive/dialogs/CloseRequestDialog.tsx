import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { sourceView } from '../../common/lib/view';
import DefaultLauncherDialog from './LauncherDialog';
import '../styles/business-dialogs.css';
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
export default function CloseRequestDialog() {
  const { window: state } = useLauncherSnapshot(), a = useLauncherActions().window, { t } = useTranslation(), stay = useRef<HTMLButtonElement>(null);
  const choose = (mode: 'stop' | 'background' | 'stay') => { if (!state.closing) void a.respondToClose(mode); };
  if (!state.request) return null;
  return <LauncherDialog title={t('window.close')} description={t('closeDialog.description')} pending={state.closing} onClose={() => choose('stay')} initialFocus={stay} data-ui-site="ImmersiveClose-shell">
    <div className="business-dialog-form" data-ui-site="ImmersiveClose-content">
      <section className="dialog-section dialog-close-state" data-ui-site="ImmersiveClose-state">{state.request.game_running && <p data-ui-site="ImmersiveClose-game">{t('closeDialog.gameRunning')}</p>}{state.request.downloads_active && <p data-ui-site="ImmersiveClose-downloads">{t('closeDialog.downloadsActive')}</p>}</section>
      <div className="dialog-close-choices" data-ui-site="ImmersiveClose-choices"><button type="button" ref={stay} className="secondary" disabled={state.closing} onClick={() => choose('stay')} data-ui-site="ImmersiveClose-stay">{t('closeDialog.stay')}</button><button type="button" className="secondary" disabled={state.closing} onClick={() => choose('background')} data-ui-site="ImmersiveClose-background">{t('closeDialog.background')}</button><button type="button" className="primary" disabled={state.closing} onClick={() => choose('stop')} data-ui-site="ImmersiveClose-stop">{t('closeDialog.stop')}</button></div>
    </div>
  </LauncherDialog>;
}
