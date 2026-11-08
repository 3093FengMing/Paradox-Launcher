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
  const s = useLauncherSnapshot(), a = useLauncherActions().removal, { t } = useTranslation(), safe = useRef<HTMLButtonElement>(null), r = s.removal;
  const saving = s.settings.saving || r.pending;
  const profile = s.config.value?.profiles.find(item => item.instance_key === r.profileKey), name = r.recovery?.name ?? profile?.name ?? r.profileKey;
  if (!r.profileKey) return null;
  return <LauncherDialog title={t('removeDialog.title', { name })} description={t(r.recovery ? 'removeDialog.partialDescription' : 'removeDialog.description')} onClose={a.cancel} pending={saving} initialFocus={safe} finalFocus={finalFocus} data-ui-site="ImmersiveRemove-shell">
    <form className="business-dialog-form" onSubmit={event => { event.preventDefault(); if (r.canSubmit) void a.submit(); }} data-ui-site="ImmersiveRemove-form">
      {r.recovery ? <section className="dialog-section dialog-error" role="alert" data-ui-site="ImmersiveRemove-recovery"><p data-ui-site="ImmersiveRemove-recovery-error">{r.recovery.error}</p><code data-ui-site="ImmersiveRemove-recovery-path">{r.recovery.instanceRoot}</code><p data-ui-site="ImmersiveRemove-recovery-help">{t('removeDialog.manualCleanup')}</p></section>
        : <section className="dialog-section" data-ui-site="ImmersiveRemove-content"><label className="inline-check" data-ui-site="ImmersiveRemove-delete-label"><input type="checkbox" disabled={saving || !s.window.desktop} checked={r.deleteFiles} onChange={event => a.setDeleteFiles(event.target.checked)} data-ui-site="ImmersiveRemove-delete"/>{t('removeDialog.deleteFiles')}</label>
          {r.deleteFiles && <div className="dialog-danger-note" data-ui-site="ImmersiveRemove-file-warning"><p data-ui-site="ImmersiveRemove-file-warning-text">{t('removeDialog.fileWarning', { key: r.profileKey })}</p><Field label={t('removeDialog.confirmName')} description={name ?? undefined} data-ui-site="ImmersiveRemove-confirm-field"><Input value={r.confirmation} required disabled={saving} autoComplete="off" onChange={event => a.setConfirmation(event.target.value)} data-ui-site="ImmersiveRemove-confirm"/></Field></div>}
        </section>}
      <footer className="dialog-actions" data-ui-site="ImmersiveRemove-actions"><button type="button" ref={safe} className="secondary" disabled={saving} onClick={a.cancel} data-ui-site="ImmersiveRemove-cancel">{t(r.recovery ? 'removeDialog.close' : 'removeDialog.keep')}</button><button type="submit" className="primary dialog-danger-action" disabled={!r.canSubmit} data-ui-site="ImmersiveRemove-submit">{saving ? <LoaderCircle size={16} className="spin" aria-hidden="true" data-ui-site="ImmersiveRemove-pending-icon"/> : <Trash2 size={16} aria-hidden="true" data-ui-site="ImmersiveRemove-remove-icon"/>}{t(r.recovery ? 'removeDialog.retryFiles' : r.deleteFiles ? 'removeDialog.deleteAndRemove' : 'removeDialog.removeRecord')}</button></footer>
    </form>
  </LauncherDialog>;
}
