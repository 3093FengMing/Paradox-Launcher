import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder, Import, LoaderCircle, Search } from 'lucide-react';
import { Badge, Field, Input, UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { sourceView } from '../../common/lib/view';
import { importDialogState, importInstanceEligible } from '../../common/lib/dialog-display';
import DefaultLauncherDialog from './LauncherDialog';
import '../styles/business-dialogs.css';
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);
export default function ImportInstancesDialog() {
  const s = useLauncherSnapshot(), a = useLauncherActions().importDraft, { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null), d = s.importDraft, { saving, locked } = importDialogState(s);
  const disabled = locked || !s.window.desktop || !!s.activity || s.downloads.active || s.downloads.pending.length > 0 || !!s.window.request;
  if (!d.open) return null;
  return <LauncherDialog title={t('importDialog.title')} description={t('importDialog.description')} pending={locked} onClose={a.cancel} initialFocus={() => input.current?.disabled ? true : input.current} data-ui-site="ImmersiveImport-shell">
    <form className="business-dialog-form" onSubmit={event => { event.preventDefault(); if (d.canSubmit) void a.submit(); }} data-ui-site="ImmersiveImport-form">
      <section className="dialog-section import-directory" data-ui-site="ImmersiveImport-directory-section">
        {!s.window.desktop && <p role="status" data-ui-site="ImmersiveImport-desktop-required">{t('importDialog.desktopRequired')}</p>}
        <Field label={t('importDialog.gameRoot')} data-ui-site="ImmersiveImport-directory-field"><Input ref={input} disabled={disabled} value={d.directory} onChange={event => a.setDirectory(event.target.value)} placeholder={t('importDialog.rootPlaceholder')} data-ui-site="ImmersiveImport-directory"/></Field>
        <div className="dialog-inline-tools" data-ui-site="ImmersiveImport-tools">
          <button type="button" className="secondary" disabled={disabled} onClick={() => void a.chooseDirectory()} data-ui-site="ImmersiveImport-choose"><Folder size={16} aria-hidden="true" data-ui-site="ImmersiveImport-choose-icon"/>{t('importDialog.chooseDirectory')}</button>
          <button type="button" className="secondary" disabled={disabled || !d.directory.trim()} onClick={() => void a.scan()} data-ui-site="ImmersiveImport-scan"><Search size={16} aria-hidden="true" data-ui-site="ImmersiveImport-scan-icon"/>{t(d.scanning ? 'importDialog.scanning' : 'importDialog.scan')}</button>
        </div>
      </section>
      {d.scanning && <p role="status" data-ui-site="ImmersiveImport-scanning">{t('importDialog.scanning')}</p>}
      {d.instances !== null && <section className="dialog-import-list" data-ui-site="ImmersiveImport-results">
        {d.instances.length ? d.instances.map(instance => <UiIdentity key={instance.instance_key} namespace="profile" value={instance.instance_key}>
          <label className="dialog-import-row" data-ui-site="ImmersiveImport-result">
            <input type="checkbox" disabled={disabled || !importInstanceEligible(instance)} checked={d.selected.includes(instance.instance_key)} onChange={event => a.setSelected(event.target.checked ? [...d.selected, instance.instance_key] : d.selected.filter(key => key !== instance.instance_key))} data-ui-site="ImmersiveImport-result-select"/>
            <div className="dialog-import-copy" data-ui-site="ImmersiveImport-result-copy"><strong data-ui-site="ImmersiveImport-result-key">{instance.instance_key}</strong><p data-ui-site="ImmersiveImport-result-description">{instance.game_version ?? t('importDialog.unknownVersion')} · {instance.loader}</p></div>
            <Badge muted={!importInstanceEligible(instance)} data-ui-site="ImmersiveImport-result-support">{t(importInstanceEligible(instance) ? 'importDialog.vanilla' : 'importDialog.unsupported')}</Badge>
          </label>
        </UiIdentity>) : <p role="status" data-ui-site="ImmersiveImport-empty">{t('importDialog.empty')}</p>}
      </section>}
      <footer className="dialog-actions" data-ui-site="ImmersiveImport-actions"><button type="button" className="secondary" onClick={a.cancel} disabled={locked} data-ui-site="ImmersiveImport-cancel">{t('common.cancel')}</button><button type="submit" className="primary" disabled={!d.canSubmit} data-ui-site="ImmersiveImport-submit">{saving ? <LoaderCircle size={16} className="spin" aria-hidden="true" data-ui-site="ImmersiveImport-saving-icon"/> : <Import size={16} aria-hidden="true" data-ui-site="ImmersiveImport-import-icon"/>}{t('importDialog.importCount', { count: d.selected.length })}</button></footer>
    </form>
  </LauncherDialog>;
}
