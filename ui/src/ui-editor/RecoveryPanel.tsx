/** @jsxImportSource react */
import { Button } from '../ui-foundation/Button';
import { Dialog } from '../ui-foundation/Overlays';
import { useTranslation } from 'react-i18next';
import { useUiEditorSnapshot } from './public';
import { useUiEditorController } from './controller';

// Fixed trusted UI. Its confirmation does not call through tool.editor or its route.
export function RecoveryPanel(): React.JSX.Element {
  const snapshot = useUiEditorSnapshot(), controller = useUiEditorController();
  const { t } = useTranslation();
  const recovery = controller.recovery;
  return <Dialog.Root open modal onOpenChange={(_open, details) => details.cancel()}><Dialog.Portal>
    <Dialog.Popup className="ui-fixed-recovery" aria-label={t('uiRecovery.title')}>
    <Dialog.Title>{t('uiRecovery.title')}</Dialog.Title>
    <Dialog.Description>{t('uiRecovery.description')}</Dialog.Description>
    <div className="ui-recovery-actions">
      <Button onClick={() => recovery.disable()}>{t('uiRecovery.disable')}</Button>
      <Button onClick={() => recovery.openBuiltinEditor()}>{t('uiRecovery.openBuiltin')}</Button>
      <Button disabled={snapshot.pending === 'export'} onClick={() => void recovery.exportRecoverable()}>{t('uiRecovery.export')}</Button>
      <Button disabled={snapshot.pending === 'reset'} onClick={() => void recovery.reset()}>{t('uiRecovery.reset')}</Button>
    </div>
    {snapshot.resetConfirmationOpen && <div role="alertdialog" aria-label={t('uiRecovery.confirmTitle')}>
      <p>{t('uiRecovery.confirmDescription')}</p>
      <Button disabled={snapshot.pending === 'reset'} onClick={() => void recovery.reset()}>{t('uiRecovery.confirm')}</Button>
      <Button onClick={() => controller.actions.cancelReset()}>{t('uiRecovery.cancel')}</Button>
    </div>}
    {snapshot.diagnostics.length > 0 && <details><summary>{t('uiRecovery.diagnostics', { count: snapshot.diagnostics.length })}</summary>
      <ul>{snapshot.diagnostics.map((message) => <li key={message}>{message}</li>)}</ul>
      <Button onClick={() => controller.actions.clearDiagnostics()}>{t('uiRecovery.clearDiagnostics')}</Button>
    </details>}
  </Dialog.Popup></Dialog.Portal></Dialog.Root>;
}
