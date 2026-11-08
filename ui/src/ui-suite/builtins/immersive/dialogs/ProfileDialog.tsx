import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Layers, LoaderCircle, Plus } from 'lucide-react';
import { Field, Input, Select } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import type { GameProfile } from '@paradox/launcher';
import '../styles/profile-dialog.css';
import { sourceView } from '../../common/lib/view';
import DefaultLauncherDialog from './LauncherDialog';
const LauncherDialog = sourceView('component.launcher-dialog', DefaultLauncherDialog);

export default function ProfileDialog() {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const { editor, pending, canSubmit, loaderCatalog } = s.profileDraft;
  const saving = s.settings.saving || pending;
  const nameInput = useRef<HTMLInputElement>(null);
  const loader = editor?.loader ?? 'vanilla';
  const matches = loaderCatalog.request?.loader === loader && loaderCatalog.request.game === editor?.version;
  const versions = matches ? loaderCatalog.versions : [];
  const loading = matches && loaderCatalog.pending;
  const error = matches ? loaderCatalog.error : null;
  const label = (value: string) => value === 'vanilla' ? t('common.vanilla') : value === 'neoforge' ? 'NeoForge' : value[0].toUpperCase() + value.slice(1);
  if (!editor) return null;
  return <LauncherDialog title={t(editor.editKey ? 'instances.rename' : 'profileDialog.createTitle')} description={t(editor.editKey ? 'profileDialog.renameDescription' : 'profileDialog.createDescription')} pending={saving} onClose={() => a.profileDraft.cancel()} initialFocus={nameInput} popupProps={{ className: 'profile-dialog immersive-profile-dialog' }} data-ui-site="ProfileDialog-shell">
        <div data-ui-site="ProfileDialog-content" className="profile-dialog-content">
          <header data-ui-site="ProfileDialog-heading" className="profile-dialog-heading"><div data-ui-site="ProfileDialog-heading-icon" className="profile-dialog-heading-icon"><Box data-ui-site="ProfileDialog-box" size={24}/></div></header>
          <div data-ui-site="ProfileDialog-summary" className="profile-dialog-summary"><Layers data-ui-site="ProfileDialog-summary-icon" size={22}/><div data-ui-site="ProfileDialog-summary-copy"><strong data-ui-site="ProfileDialog-summary-version">{editor.version}</strong><span data-ui-site="ProfileDialog-summary-loader">{label(loader)}{loader !== 'vanilla' && editor.loader_version ? ` · ${editor.loader_version}` : ''}</span></div></div>
          <form data-ui-site="ProfileDialog-form" className="profile-dialog-form" onSubmit={event => { event.preventDefault(); if (canSubmit && !saving) void a.profileDraft.submit(); }}>
            <Field data-ui-site="ProfileDialog-name-field" label={t('instances.name')}><Input data-ui-site="ProfileDialog-name" ref={nameInput} id="profile-name" required maxLength={64} disabled={saving} placeholder={t('profileDialog.namePlaceholder')} value={editor.name} onChange={event => a.profileDraft.patch({ name: event.target.value })}/></Field>
            <Field data-ui-site="ProfileDialog-version-field" label={t('common.minecraftVersion')}><Input data-ui-site="ProfileDialog-version" required disabled={saving || !!editor.editKey} value={editor.version} onChange={event => a.profileDraft.patch({ version: event.target.value })}/></Field>
            {!editor.editKey && <div data-ui-site="ProfileDialog-loader-fields" className="profile-dialog-loader-fields">
              <Field data-ui-site="ProfileDialog-loader-field" label={t('loaders.type')} description={loader === 'forge' ? t('loaders.forgeRange') : undefined}><Select data-ui-site="ProfileDialog-loader" value={loader} disabled={saving} onValueChange={value => a.profileDraft.patch({ loader: value as GameProfile['loader'] })} options={['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].map(value => ({ value, label: label(value) }))}/></Field>
              {loader !== 'vanilla' && <Field data-ui-site="ProfileDialog-loader-version-field" label={t('loaders.version')} description={error || t(loading ? 'loaders.loading' : versions.length ? 'loaders.compatibility' : 'loaders.empty')}><Select data-ui-site="ProfileDialog-loader-version" required disabled={saving || loading || !matches || !!error} value={editor.loader_version ?? ''} onValueChange={value => a.profileDraft.patch({ loader_version: value })} options={[{ value: '', label: t('loaders.choose') }, ...versions.map(item => ({ value: item.version, label: `${item.version}${item.stable ? '' : ` · ${t('loaders.experimental')}`}` }))]}/></Field>}
              {error && loader !== 'vanilla' && <button data-ui-site="ProfileDialog-retry-loaders" type="button" className="text-button" disabled={saving || loading} onClick={() => void a.catalog.requestLoaders(loader, editor.version)}>{t('common.retry')}</button>}
            </div>}
            {!editor.editKey && <p data-ui-site="ProfileDialog-install-note" className="profile-dialog-install-note"><Layers data-ui-site="ProfileDialog-note-icon" size={17}/>{t('versionDownloads.createThenInstall')}</p>}
            <footer data-ui-site="ProfileDialog-actions" className="profile-dialog-actions"><button data-ui-site="ProfileDialog-cancel" type="button" className="secondary" disabled={saving} onClick={() => a.profileDraft.cancel()}>{t('common.cancel')}</button><button data-ui-site="ProfileDialog-submit" type="submit" className="primary" disabled={!canSubmit || saving}>{saving ? <LoaderCircle data-ui-site="ProfileDialog-saving-icon" size={16} className="spin"/> : <Plus data-ui-site="ProfileDialog-create-icon" size={16}/>} {t(editor.editKey ? 'profileDialog.saveName' : 'common.createInstance')}</button></footer>
          </form>
        </div>
  </LauncherDialog>;
}
