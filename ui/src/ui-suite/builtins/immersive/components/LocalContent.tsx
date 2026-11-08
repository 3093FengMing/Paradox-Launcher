import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderOpen, RefreshCw, Trash2 } from 'lucide-react';
import { UiIdentity } from '@paradox/ui';
import { useLauncherSnapshot, useLauncherActions } from '@paradox/launcher';
import type { ContentCategory } from '@paradox/launcher';
import { viewProps } from '../../common/lib/view';
import '../styles/instance-detail.css';
type LocalProps = { profileKey?: string; category?: ContentCategory };
export default function LocalContent(input?: LocalProps & { props?: Readonly<Record<string, unknown>> }) {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const p = viewProps<LocalProps>(input), key = p.profileKey;
  const entry = s.profiles.items.find(item => item.profile.instance_key === key), exists = !!entry;
  const category = p.category ?? s.content.category, c = s.content;
  const base = entry && s.config.value ? entry.profile.game_directory ?? s.config.value.settings.game_directory : null;
  useEffect(() => {
    if (!exists || !key) return;
    a.content.selectProfile(key);
    a.content.setCategory(category);
  }, [a, key, exists, category]);
  if (!entry || !key || base === null) return <section data-ui-site="LocalContent-missing" className="instance-missing"><p data-ui-site="LocalContent-missing-copy">{t('instancePages.missing')}</p><button data-ui-site="LocalContent-missing-back" className="secondary" onClick={() => a.navigation.navigate('instances')}>{t('instancePages.back')}</button></section>;
  const matches = (value: { profileKey: string; directory: string; category: ContentCategory } | null) => !!value && value.profileKey === key && value.directory === base && value.category === category;
  const selected = c.selectedProfileKey === key && c.category === category;
  const request = selected && matches(c.listRequest) ? c.listRequest : null;
  const list = request && !request.loading && !request.error && matches(c.list) ? c.list : null;
  const readDisabled = !selected || !s.window.desktop || c.pending;
  const mutationDisabled = readDisabled || !list || !!s.activity || s.settings.saving || s.downloads.active || s.downloads.pending.length > 0;
  const folder = base.replace(/[\\/]+$/, '') + '/versions/' + key + '/' + category;
  return <UiIdentity namespace="profile" value={key}><UiIdentity namespace="category" value={category}>
    <section data-ui-site="LocalContent-root" className="instance-local" data-profile-key={key} data-category={category} aria-busy={!!request?.loading}>
      <header data-ui-site="LocalContent-header" className="instance-section-heading"><div data-ui-site="LocalContent-heading"><h2 data-ui-site="LocalContent-title">{t(`content.categories.${category}`)}</h2><p data-ui-site="LocalContent-directory" className="instance-path" title={folder}>{folder}</p></div>
        <div data-ui-site="LocalContent-toolbar" className="instance-actions"><button data-ui-site="LocalContent-folder" className="secondary small" disabled={readDisabled} onClick={() => void a.content.openDirectory()}><FolderOpen size={15} data-ui-site="LocalContent-folder-icon" />{t('instancePages.openCategory', { category: t(`content.categories.${category}`) })}</button><button data-ui-site="LocalContent-refresh" className="secondary small" disabled={readDisabled} onClick={() => void a.content.refresh()}><RefreshCw size={15} data-ui-site="LocalContent-refresh-icon" />{t('content.refresh')}</button></div>
      </header>
      {!s.window.desktop ? <p data-ui-site="LocalContent-desktop" role="status">{t('api.desktopOnly')}</p>
        : request?.error ? <div data-ui-site="LocalContent-error" className="instance-message" role="alert"><p data-ui-site="LocalContent-error-copy">{request.error}</p><button data-ui-site="LocalContent-retry" className="secondary" disabled={readDisabled} onClick={() => void a.content.refresh()}>{t('instancePages.retry')}</button></div>
        : !list ? <p data-ui-site="LocalContent-loading" role="status">{t('instancePages.loading')}</p>
        : list.entries.length === 0 ? <p data-ui-site="LocalContent-empty" className="instance-message">{t('content.empty')}</p>
        : <div data-ui-site="LocalContent-list" className="instance-local-list">{list.entries.map(file => <UiIdentity key={key + ':' + category + ':' + file.name} namespace="file" value={file.name}>
          <article data-ui-site="LocalContent-row" className="instance-local-row" data-file-name={file.name}>
            <div data-ui-site="LocalContent-file"><strong data-ui-site="LocalContent-name">{file.record?.title ?? file.name}</strong><p data-ui-site="LocalContent-meta">{file.name} · {(file.size / 1024).toFixed(1)} KiB</p>{category === 'mods' && <span data-ui-site="LocalContent-state" className="instance-tag">{t(file.enabled ? 'content.enabled' : 'content.disabled')}</span>}</div>
            <div data-ui-site="LocalContent-row-actions" className="instance-actions">
              {category === 'mods' && <button data-ui-site="LocalContent-toggle" className="secondary small" disabled={mutationDisabled} onClick={() => void a.content.toggleMod(file.name)}>{t(file.enabled ? 'content.disable' : 'content.enable')}</button>}
              {category !== 'saves' && (c.removing === file.name ? <div data-ui-site="LocalContent-confirmation" className="instance-confirmation" role="group" aria-label={t('content.confirmRemove')}><span data-ui-site="LocalContent-confirm-name">{t('instancePages.removeFile', { name: file.name })}</span><button data-ui-site="LocalContent-confirm" className="danger small" disabled={mutationDisabled} onClick={() => void a.content.confirmRemove()}>{t('content.confirmRemove')}</button><button data-ui-site="LocalContent-cancel" className="secondary small" disabled={c.pending} onClick={() => a.content.cancelRemove()}>{t('common.cancel')}</button></div> : <button data-ui-site="LocalContent-remove" className="secondary small" disabled={mutationDisabled} aria-label={t('instancePages.removeFile', { name: file.name })} onClick={() => a.content.beginRemove(file.name)}><Trash2 size={14} data-ui-site="LocalContent-remove-icon" />{t('content.remove')}</button>)}
            </div>
          </article>
        </UiIdentity>)}</div>}
      {category === 'saves' && <p data-ui-site="LocalContent-saves-note" className="instance-note">{t('instancePages.savesReadOnly')}</p>}
    </section>
  </UiIdentity></UiIdentity>;
}
