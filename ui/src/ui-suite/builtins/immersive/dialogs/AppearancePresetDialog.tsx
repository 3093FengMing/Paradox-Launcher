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
  const d = presetDialogState(s), name = useRef<HTMLInputElement>(null), json = useRef<HTMLTextAreaElement>(null), safe = useRef<HTMLButtonElement>(null);
  const [copyState, setCopyState] = useState({ key: d.requestKey, copied: false });
  if (copyState.key !== d.requestKey) setCopyState({ key: d.requestKey, copied: false });
  const submit = async () => {
    if (!d.request || !d.draft || d.actionBlocked) return;
    try {
      switch (d.request.kind) {
        case 'save': await a.save(d.draft.name); break;
        case 'rename': await a.rename(d.request.id, d.draft.name); break;
        case 'remove': await a.remove(d.request.id); break;
        case 'import': await a.import(d.draft.json); break;
        case 'export': await a.copyExport(d.request.id); setCopyState({ key: d.requestKey, copied: true }); break;
      }
    } catch { /* The permanent owner keeps input and failure. */ }
  };
  if (!d.request || !d.draft) return null;
  const request = d.request, draft = d.draft, copied = copyState.key === d.requestKey && copyState.copied;
  const focus = () => {
    const target = request.kind === 'save' || request.kind === 'rename' ? name.current : request.kind === 'import' || request.kind === 'export' ? json.current : safe.current;
    return target?.disabled ? safe.current : target;
  };
  return <UiIdentity namespace="appearance-preset" value={'id' in request ? request.id : request.kind}><LauncherDialog title={t(`presets.dialog.${request.kind}.title`)} description={t(`presets.dialog.${request.kind}.description`, { name: d.selected?.name })} onClose={a.cancelDialog} pending={d.pending} initialFocus={focus} data-ui-site="ImmersivePreset-shell">
    <form className="business-dialog-form" onSubmit={event => { event.preventDefault(); void submit(); }} data-ui-site="ImmersivePreset-form">
      <section className="dialog-section" data-ui-site="ImmersivePreset-content">
        {(request.kind === 'save' || request.kind === 'rename') && <Field label={t('presets.name')} description={t('presets.nameHint')} data-ui-site="ImmersivePreset-name-field"><Input ref={name} value={draft.name} required maxLength={96} disabled={d.blocked} placeholder={t('presets.namePlaceholder')} onChange={event => a.patchDraft({ name: event.target.value })} data-ui-site="ImmersivePreset-name"/></Field>}
        {request.kind === 'import' && <Field label={t('presets.json')} description={t('presets.importHint')} data-ui-site="ImmersivePreset-import-field"><TextArea ref={json} value={draft.json} disabled={d.blocked} rows={10} required maxLength={32 * 1024} spellCheck={false} placeholder={t('presets.jsonPlaceholder')} onChange={event => a.patchDraft({ json: event.target.value })} data-ui-site="ImmersivePreset-import"/></Field>}
        {request.kind === 'export' && <Field label={t('presets.json')} description={t('presets.exportHint')} data-ui-site="ImmersivePreset-export-field"><TextArea ref={json} readOnly value={draft.json} rows={12} spellCheck={false} onFocus={event => event.target.select()} data-ui-site="ImmersivePreset-export"/></Field>}
        {request.kind === 'remove' && <div className="dialog-danger-note" data-ui-site="ImmersivePreset-remove-name">{d.selected?.name}</div>}
        {draft.error && <p className="dialog-error" role="alert" data-ui-site="ImmersivePreset-error">{t(draft.error)}</p>}
      </section>
      <footer className="dialog-actions" data-ui-site="ImmersivePreset-actions"><button ref={safe} type="button" className="secondary" disabled={d.pending} onClick={a.cancelDialog} data-ui-site="ImmersivePreset-cancel">{t(request.kind === 'export' ? 'presets.close' : 'presets.cancel')}</button><button type="submit" className={`primary ${request.kind === 'remove' ? 'dialog-danger-action' : ''}`} disabled={d.actionBlocked} data-ui-site="ImmersivePreset-submit">{d.pending ? <LoaderCircle size={16} className="spin" aria-hidden="true" data-ui-site="ImmersivePreset-pending-icon"/> : request.kind === 'export' ? <Copy size={16} aria-hidden="true" data-ui-site="ImmersivePreset-copy-icon"/> : null}{t(request.kind === 'export' && copied ? 'presets.copied' : `presets.dialog.${request.kind}.action`)}</button></footer>
    </form>
  </LauncherDialog></UiIdentity>;
}
