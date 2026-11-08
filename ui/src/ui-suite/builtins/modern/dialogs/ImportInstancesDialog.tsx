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
  const s = useLauncherSnapshot(), a = useLauncherActions().importDraft, { t } = useTranslation(), directoryInput = useRef<HTMLInputElement>(null);
  const { directory, instances, selected, scanning, canSubmit } = s.importDraft;
  const { saving, locked } = importDialogState(s), desktop = s.window.desktop;
  const disabled = locked || !desktop || !!s.activity || s.downloads.active || s.downloads.pending.length > 0 || !!s.window.request;
  if (!s.importDraft.open) return null;
  return <LauncherDialog title={t('importDialog.title')} description={t('importDialog.description')} pending={locked} onClose={a.cancel} initialFocus={() => !directoryInput.current?.disabled ? directoryInput.current : true} data-ui-site="ModernImport-shell">
    <form className="business-dialog-form" onSubmit={event => { event.preventDefault(); if (canSubmit) void a.submit(); }} data-ui-site="ModernImport-form">
      <section className="dialog-section" data-ui-site="ModernImport-directory-section">
        {!desktop && <p role="status" data-ui-site="ModernImport-desktop-required">{t('importDialog.desktopRequired')}</p>}
        <Field label={t('importDialog.gameRoot')} data-ui-site="ModernImport-directory-field"><Input ref={directoryInput} value={directory} disabled={disabled} placeholder={t('importDialog.rootPlaceholder')} onChange={event => a.setDirectory(event.target.value)} data-ui-site="ModernImport-directory"/></Field>
        <div className="dialog-inline-tools" data-ui-site="ModernImport-tools"><button type="button" className="secondary" disabled={disabled} onClick={() => void a.chooseDirectory()} data-ui-site="ModernImport-choose"><Folder size={16} aria-hidden="true" data-ui-site="ModernImport-choose-icon"/>{t('importDialog.chooseDirectory')}</button><button type="button" className="secondary" disabled={disabled || !directory.trim()} onClick={() => void a.scan()} data-ui-site="ModernImport-scan"><Search size={16} aria-hidden="true" data-ui-site="ModernImport-scan-icon"/>{t(scanning ? 'importDialog.scanning' : 'importDialog.scan')}</button></div>
      </section>
      {scanning && <p role="status" data-ui-site="ModernImport-scanning">{t('importDialog.scanning')}</p>}
      {instances !== null && <section className="dialog-import-list" data-ui-site="ModernImport-results">{instances.length ? instances.map(instance => <UiIdentity namespace="profile" value={instance.instance_key} key={instance.instance_key}>
        <label className="dialog-import-row" data-ui-site="ModernImport-result">
          <input type="checkbox" disabled={disabled || !importInstanceEligible(instance)} checked={selected.includes(instance.instance_key)} onChange={event => a.setSelected(event.target.checked ? [...selected, instance.instance_key] : selected.filter(key => key !== instance.instance_key))} data-ui-site="ModernImport-result-select"/>
          <span className="dialog-import-copy" data-ui-site="ModernImport-result-copy"><strong data-ui-site="ModernImport-result-key">{instance.instance_key}</strong><span data-ui-site="ModernImport-result-description">{instance.game_version ?? t('importDialog.unknownVersion')} · {instance.loader}</span></span>
          <Badge muted={!importInstanceEligible(instance)} data-ui-site="ModernImport-result-support">{t(importInstanceEligible(instance) ? 'importDialog.vanilla' : 'importDialog.unsupported')}</Badge>
        </label>
      </UiIdentity>) : <p role="status" data-ui-site="ModernImport-empty">{t('importDialog.empty')}</p>}</section>}
      <footer className="dialog-actions" data-ui-site="ModernImport-actions"><button type="button" className="secondary" disabled={locked} onClick={a.cancel} data-ui-site="ModernImport-cancel">{t('common.cancel')}</button><button type="submit" className="primary" disabled={!canSubmit} data-ui-site="ModernImport-submit">{saving ? <LoaderCircle size={16} className="spin" aria-hidden="true" data-ui-site="ModernImport-saving-icon"/> : <Import size={16} aria-hidden="true" data-ui-site="ModernImport-import-icon"/>}{t('importDialog.importCount', { count: selected.length })}</button></footer>
    </form>
  </LauncherDialog>;
}
