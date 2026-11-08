import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, Trash2 } from 'lucide-react';
import { Field, Input } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { sourceView } from '../../common/lib/view';
import DefaultLauncherDialog from './LauncherDialog';
import '../styles/business-dialogs.css';
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
export default function RemoveProfileDialog() {
  const [origin] = useState(() => {
    const element = document.activeElement;
    return element instanceof HTMLElement && element.matches('button, input, textarea, select, a[href], [tabindex]') ? element : null;
  });
  const finalFocus = () => origin?.isConnected ? origin : document.querySelector<HTMLElement>('[data-ui-site$=":InstancesPage-create"], [data-ui-site="InstancesPage-create"]') ?? true;
  const s = useLauncherSnapshot(), a = useLauncherActions().removal, { t } = useTranslation(), safe = useRef<HTMLButtonElement>(null);
  const { profileKey, deleteFiles, confirmation, pending, canSubmit, recovery } = s.removal;
  const saving = s.settings.saving || pending;
  const profile = s.config.value?.profiles.find(item => item.instance_key === profileKey), name = recovery?.name ?? profile?.name ?? profileKey;
  if (!profileKey) return null;
  return <LauncherDialog title={t('removeDialog.title', { name })} description={t(recovery ? 'removeDialog.partialDescription' : 'removeDialog.description')} pending={saving} onClose={a.cancel} initialFocus={safe} finalFocus={finalFocus} data-ui-site="ModernRemove-shell">
    <form className="business-dialog-form" onSubmit={event => { event.preventDefault(); if (canSubmit) void a.submit(); }} data-ui-site="ModernRemove-form">
      <section className="dialog-section" data-ui-site="ModernRemove-content">
        {recovery ? <div className="dialog-error" role="alert" data-ui-site="ModernRemove-recovery"><p data-ui-site="ModernRemove-recovery-error">{recovery.error}</p><code data-ui-site="ModernRemove-recovery-path">{recovery.instanceRoot}</code><p data-ui-site="ModernRemove-recovery-help">{t('removeDialog.manualCleanup')}</p></div>
          : <label className="inline-check" data-ui-site="ModernRemove-delete-label"><input type="checkbox" checked={deleteFiles} disabled={saving || !s.window.desktop} onChange={event => a.setDeleteFiles(event.target.checked)} data-ui-site="ModernRemove-delete"/>{t('removeDialog.deleteFiles')}</label>}
        {deleteFiles && !recovery && <div className="dialog-danger-note" data-ui-site="ModernRemove-file-warning"><p data-ui-site="ModernRemove-file-warning-text">{t('removeDialog.fileWarning', { key: profileKey })}</p><Field label={t('removeDialog.confirmName')} description={name ?? undefined} data-ui-site="ModernRemove-confirm-field"><Input required autoComplete="off" disabled={saving} value={confirmation} onChange={event => a.setConfirmation(event.target.value)} data-ui-site="ModernRemove-confirm"/></Field></div>}
      </section>
      <footer className="dialog-actions" data-ui-site="ModernRemove-actions"><button ref={safe} type="button" className="secondary" disabled={saving} onClick={a.cancel} data-ui-site="ModernRemove-cancel">{t(recovery ? 'removeDialog.close' : 'removeDialog.keep')}</button><button type="submit" className="primary dialog-danger-action" disabled={!canSubmit} data-ui-site="ModernRemove-submit">{saving ? <LoaderCircle size={16} className="spin" aria-hidden="true" data-ui-site="ModernRemove-pending-icon"/> : <Trash2 size={16} aria-hidden="true" data-ui-site="ModernRemove-remove-icon"/>}{t(recovery ? 'removeDialog.retryFiles' : deleteFiles ? 'removeDialog.deleteAndRemove' : 'removeDialog.removeRecord')}</button></footer>
    </form>
  </LauncherDialog>;
}
