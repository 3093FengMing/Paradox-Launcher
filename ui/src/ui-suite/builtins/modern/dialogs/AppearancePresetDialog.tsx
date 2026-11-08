import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, LoaderCircle } from 'lucide-react';
import { Field, Input, TextArea, UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { sourceView } from '../../common/lib/view';
import { presetDialogState } from '../../common/lib/dialog-display';
import DefaultLauncherDialog from './LauncherDialog';
import '../styles/business-dialogs.css';
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
export default function AppearancePresetDialog() {
  const s = useLauncherSnapshot(), a = useLauncherActions().presets, { t } = useTranslation();
  const { draft, request, selected, pending, blocked, actionBlocked, requestKey } = presetDialogState(s);
  const name = useRef<HTMLInputElement>(null), json = useRef<HTMLTextAreaElement>(null), safe = useRef<HTMLButtonElement>(null);
  const [acknowledgement, setAcknowledgement] = useState({ key: requestKey, copied: false });
  if (acknowledgement.key !== requestKey) setAcknowledgement({ key: requestKey, copied: false });
  const copied = acknowledgement.key === requestKey && acknowledgement.copied;
  const copy = async () => { if (!request || request.kind !== 'export' || actionBlocked) return; try { await a.copyExport(request.id); setAcknowledgement({ key: requestKey, copied: true }); } catch { /* The owner retains the error. */ } };
  const submit = async () => {
    if (!request || !draft || actionBlocked) return;
    try { switch (request.kind) {
      case 'save': await a.save(draft.name); break;
      case 'rename': await a.rename(request.id, draft.name); break;
      case 'remove': await a.remove(request.id); break;
      case 'import': await a.import(draft.json); break;
      case 'export': await copy(); break;
    } } catch { /* The owner retains the entered values and error. */ }
  };
  if (!request || !draft) return null;
  return <UiIdentity namespace="appearance-preset" value={'id' in request ? request.id : request.kind}><LauncherDialog title={t(`presets.dialog.${request.kind}.title`)} description={t(`presets.dialog.${request.kind}.description`, { name: selected?.name })} pending={pending} onClose={a.cancelDialog}
    initialFocus={() => request.kind === 'save' || request.kind === 'rename' ? (name.current?.disabled ? safe.current : name.current) : request.kind === 'import' || request.kind === 'export' ? (json.current?.disabled ? safe.current : json.current) : safe.current} data-ui-site="ModernPreset-shell">
    <form className="business-dialog-form" data-ui-site="ModernPreset-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <section className="dialog-section" data-ui-site="ModernPreset-content">
        {(request.kind === 'save' || request.kind === 'rename') && <Field label={t('presets.name')} description={t('presets.nameHint')} data-ui-site="ModernPreset-name-field"><Input ref={name} required maxLength={96} value={draft.name} disabled={blocked} placeholder={t('presets.namePlaceholder')} onChange={event => a.patchDraft({ name: event.target.value })} data-ui-site="ModernPreset-name"/></Field>}
        {request.kind === 'import' && <Field label={t('presets.json')} description={t('presets.importHint')} data-ui-site="ModernPreset-import-field"><TextArea ref={json} required rows={10} maxLength={32 * 1024} spellCheck={false} value={draft.json} disabled={blocked} onChange={event => a.patchDraft({ json: event.target.value })} placeholder={t('presets.jsonPlaceholder')} data-ui-site="ModernPreset-import"/></Field>}
        {request.kind === 'export' && <Field label={t('presets.json')} description={t('presets.exportHint')} data-ui-site="ModernPreset-export-field"><TextArea ref={json} readOnly rows={12} spellCheck={false} value={draft.json} onFocus={event => event.target.select()} data-ui-site="ModernPreset-export"/></Field>}
        {request.kind === 'remove' && <p className="dialog-danger-note" data-ui-site="ModernPreset-remove-name">{selected?.name}</p>}
        {draft.error && <p className="dialog-error" role="alert" data-ui-site="ModernPreset-error">{t(draft.error)}</p>}
      </section>
      <footer className="dialog-actions" data-ui-site="ModernPreset-actions"><button ref={safe} type="button" className="secondary" disabled={pending} onClick={a.cancelDialog} data-ui-site="ModernPreset-cancel">{t(request.kind === 'export' ? 'presets.close' : 'presets.cancel')}</button><button type="submit" className={`primary ${request.kind === 'remove' ? 'dialog-danger-action' : ''}`} disabled={actionBlocked} data-ui-site="ModernPreset-submit">{pending ? <LoaderCircle size={16} className="spin" aria-hidden="true" data-ui-site="ModernPreset-pending-icon"/> : request.kind === 'export' ? <Copy size={16} aria-hidden="true" data-ui-site="ModernPreset-copy-icon"/> : null}{t(request.kind === 'export' && copied ? 'presets.copied' : `presets.dialog.${request.kind}.action`)}</button></footer>
    </form>
  </LauncherDialog></UiIdentity>;
}
