import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Database, Layers, Plus, RefreshCw, Search } from 'lucide-react';
import { UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import '../styles/versions.css';

export default function VersionsPage() {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t, i18n } = useTranslation();
  const [kind, setKind] = useState('all'), [limit, setLimit] = useState(100);
  const { versions, snapshot: catalog, busy, error } = s.catalog;
  const showSnapshots = s.config.value?.settings.show_snapshots ?? false;
  const search = s.navigation.search;
  const blocked = !s.config.ready || !s.settings.draft || !!s.activity || s.settings.saving || s.downloads.active || s.downloads.pending.length > 0 || !!s.window.request;
  const group = (value: string) => value === 'release' || value === 'snapshot' ? value : 'other';
  const effectiveKind = showSnapshots ? kind : 'release';
  const visible = versions.filter(v => (showSnapshots || v.kind === 'release') && (effectiveKind === 'all' || group(v.kind) === effectiveKind) && v.id.toLowerCase().includes(search.toLowerCase()));
  // Catalog owner deduplicates repeated mounts and preserves the last successful catalog.
  useEffect(() => { void a.catalog.refresh(); }, [a.catalog]);
  const selectKind = (value: string) => { setKind(value); setLimit(100); };
  return <section data-ui-site="VersionsPage-root" className="versions-page modern-versions">
    <div data-ui-site="VersionsPage-toolbar" className="versions-toolbar">
      <label data-ui-site="VersionsPage-search-label" className="versions-search"><Search data-ui-site="VersionsPage-search-icon" size={17}/><input data-ui-site="VersionsPage-search" aria-label={t('downloads.search')} placeholder={t('downloads.searchPlaceholder')} value={search} onChange={e => { a.navigation.setSearch(e.target.value); setLimit(100); }}/></label>
      <button data-ui-site="VersionsPage-refresh" className="secondary" disabled={busy} onClick={() => void a.catalog.refresh(true)}><RefreshCw data-ui-site="VersionsPage-refresh-icon" size={16} className={busy ? 'spin' : ''}/>{t(busy ? 'downloads.fetching' : 'downloads.refresh')}</button>
      <button data-ui-site="VersionsPage-manual" className="primary" disabled={blocked} onClick={() => a.profileDraft.openCreate()}><Plus data-ui-site="VersionsPage-manual-icon" size={16}/>{t('downloads.enterVersion')}</button>
    </div>
    <div data-ui-site="VersionsPage-layout" className="versions-layout">
      <aside data-ui-site="VersionsPage-filters" className="versions-filter-panel">
        <h2 data-ui-site="VersionsPage-filter-title">{t('downloads.type')}</h2>
        <div data-ui-site="VersionsPage-kind-filters" className="versions-kind-filters" role="group" aria-label={t('downloads.type')}>{(showSnapshots ? ['all', 'release', 'snapshot', 'other'] : ['release']).map(value => <button data-ui-site="VersionsPage-kind" key={value} aria-pressed={effectiveKind === value} onClick={() => selectKind(value)}><span data-ui-site="VersionsPage-kind-label">{t(`versionDownloads.types.${value}`)}</span><span data-ui-site="VersionsPage-kind-count">{versions.filter(v => value === 'all' || group(v.kind) === value).length}</span></button>)}</div>
        <label data-ui-site="VersionsPage-snapshots-label" className="versions-snapshots"><input data-ui-site="VersionsPage-snapshots" type="checkbox" checked={showSnapshots} disabled={blocked} onChange={e => { setLimit(100); void a.catalog.setSnapshots(e.target.checked); }}/>{t('downloads.showSnapshots')}</label>
        <p data-ui-site="VersionsPage-loader-note" className="versions-loader-note"><Layers data-ui-site="VersionsPage-loader-icon" size={18}/>{t('versionDownloads.loaderHint')}</p>
      </aside>
      <div data-ui-site="VersionsPage-catalog" className="versions-catalog">
        <div data-ui-site="VersionsPage-cache" className="versions-cache"><Database data-ui-site="VersionsPage-cache-icon" size={16}/><div data-ui-site="VersionsPage-cache-copy" className="versions-cache-copy"><strong data-ui-site="VersionsPage-cache-source">{t(catalog ? catalog.source === 'cache' ? 'downloads.localCache' : 'downloads.networkCatalog' : 'versionDownloads.notFetched')}</strong>{catalog && <span data-ui-site="VersionsPage-cache-time">{new Date(catalog.fetched_at * 1000).toLocaleString(i18n.resolvedLanguage)}{catalog.stale ? t('downloads.staleSuffix') : ''}</span>}</div><span data-ui-site="VersionsPage-count">{t('downloads.versionCount', { count: visible.length })}</span></div>
        {catalog?.warning && <p data-ui-site="VersionsPage-warning" className="versions-message" role="status">{catalog.warning}</p>}
        {error && <div data-ui-site="VersionsPage-error" className="versions-message is-error" role="alert"><span data-ui-site="VersionsPage-error-copy">{error}</span><button data-ui-site="VersionsPage-retry" className="text-button" disabled={busy} onClick={() => void a.catalog.refresh(true)}>{t('common.retry')}</button></div>}
        <div data-ui-site="VersionsPage-list" className="versions-list">
          {visible.slice(0, limit).map(version => <UiIdentity key={version.id} namespace="version" value={version.id}><article data-ui-site="VersionsPage-version" className="versions-row"><div data-ui-site="VersionsPage-version-name" className="versions-name"><Box data-ui-site="VersionsPage-version-icon" size={21}/><strong data-ui-site="VersionsPage-version-id">{version.id}</strong></div><span data-ui-site="VersionsPage-version-kind" className={`versions-tag is-${group(version.kind)}`}>{t(`versionDownloads.types.${group(version.kind)}`)}</span><button data-ui-site="VersionsPage-create" className="secondary small" disabled={blocked} onClick={() => a.profileDraft.openCreate(version.id)}><Plus data-ui-site="VersionsPage-create-icon" size={15}/>{t('common.createInstance')}</button></article></UiIdentity>)}
          {!visible.length && <div data-ui-site="VersionsPage-empty" className="versions-empty"><Box data-ui-site="VersionsPage-empty-icon" size={30}/><h3 data-ui-site="VersionsPage-empty-title">{t(versions.length ? 'downloads.noMatches' : busy ? 'downloads.loadingCatalog' : 'downloads.emptyTitle')}</h3><p data-ui-site="VersionsPage-empty-copy">{t(versions.length ? 'versionDownloads.changeFilters' : 'downloads.emptyDescription')}</p></div>}
        </div>
        <footer data-ui-site="VersionsPage-footer" className="versions-footer"><span data-ui-site="VersionsPage-shown">{t('versionDownloads.shown', { shown: Math.min(limit, visible.length), total: visible.length })}</span>{visible.length > limit && <button data-ui-site="VersionsPage-more" className="secondary small" onClick={() => setLimit(value => value + 100)}>{t('versionDownloads.loadMore')}</button>}</footer>
      </div>
    </div>
  </section>;
}
