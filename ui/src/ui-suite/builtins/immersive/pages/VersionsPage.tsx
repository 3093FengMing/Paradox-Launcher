import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, ChevronDown, Database, Layers, Plus, RefreshCw, Search } from 'lucide-react';
import { Select, UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import '../styles/versions.css';

const PAGE_SIZE = 30;
const group = (value: string) => value === 'release' || value === 'snapshot' ? value : 'other';

export default function VersionsPage() {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t, i18n } = useTranslation();
  const [kind, setKind] = useState('all');
  const [pagination, setPagination] = useState({ key: '', limit: PAGE_SIZE });
  const { versions, snapshot: catalog, busy, error } = s.catalog;
  const showSnapshots = s.config.value?.settings.show_snapshots ?? false;
  const search = s.navigation.search;
  const blocked = !s.config.ready || !s.settings.draft || !!s.activity || s.settings.saving || s.downloads.active || s.downloads.pending.length > 0 || !!s.window.request;
  const effectiveKind = showSnapshots ? kind : 'release';
  const visible = versions.filter(v => (showSnapshots || v.kind === 'release') && (effectiveKind === 'all' || group(v.kind) === effectiveKind) && v.id.toLowerCase().includes(search.toLowerCase()));
  const paginationKey = JSON.stringify([search, effectiveKind, showSnapshots, catalog?.fetched_at, versions.length]);
  const limit = pagination.key === paginationKey ? pagination.limit : PAGE_SIZE;
  if (pagination.key !== paginationKey) setPagination({ key: paginationKey, limit: PAGE_SIZE });
  // The API returns a cached catalog index; render only the requested batch of rows.
  // The catalog owner deduplicates repeated mounts and preserves the last successful result.
  useEffect(() => { void a.catalog.refresh(); }, [a.catalog]);
  const kindOptions = (showSnapshots ? ['all', 'release', 'snapshot', 'other'] : ['release']).map(value => ({
    value,
    label: <span data-ui-site="VersionsPage-kind-label">{t('versionDownloads.types.' + value)} <span data-ui-site="VersionsPage-kind-count">({versions.filter(v => value === 'all' || group(v.kind) === value).length})</span></span>,
  }));

  return <section data-ui-site="VersionsPage-root" className="versions-page immersive-versions">
    <header data-ui-site="VersionsPage-intro" className="versions-intro"><div data-ui-site="VersionsPage-intro-copy"><h2 data-ui-site="VersionsPage-intro-title">{t('versionDownloads.chooseVersion')}</h2><p data-ui-site="VersionsPage-intro-description">{t('versionDownloads.loaderHint')}</p></div></header>
    <div data-ui-site="VersionsPage-layout" className="versions-layout">
      <div data-ui-site="VersionsPage-toolbar" className="versions-toolbar">
        <label data-ui-site="VersionsPage-search-label" className="versions-search"><Search data-ui-site="VersionsPage-search-icon" size={17} aria-hidden="true"/><input data-ui-site="VersionsPage-search" type="search" aria-label={t('downloads.search')} placeholder={t('downloads.searchPlaceholder')} value={search} onChange={e => a.navigation.setSearch(e.target.value)}/></label>
        <div data-ui-site="VersionsPage-filters" className="versions-filter-panel">
          <div data-ui-site="VersionsPage-kind-filters" className="versions-kind-field"><span data-ui-site="VersionsPage-filter-title" className="versions-filter-label"><Layers data-ui-site="VersionsPage-kind-icon" size={16} aria-hidden="true"/>{t('downloads.type')}</span><Select data-ui-site="VersionsPage-kind" aria-label={t('downloads.type')} value={effectiveKind} options={kindOptions} onValueChange={setKind}/></div>
          <label data-ui-site="VersionsPage-snapshots-label" className="versions-snapshots"><input data-ui-site="VersionsPage-snapshots" type="checkbox" checked={showSnapshots} disabled={blocked} onChange={e => void a.catalog.setSnapshots(e.target.checked)}/>{t('downloads.showSnapshots')}</label>
        </div>
        <button data-ui-site="VersionsPage-refresh" className="secondary" disabled={busy} onClick={() => void a.catalog.refresh(true)}><RefreshCw data-ui-site="VersionsPage-refresh-icon" size={16} className={busy ? 'spin' : ''} aria-hidden="true"/>{t(busy ? 'downloads.fetching' : 'downloads.refresh')}</button>
      </div>

      <div data-ui-site="VersionsPage-catalog" className="versions-catalog">
        <div data-ui-site="VersionsPage-cache" className="versions-cache"><Database data-ui-site="VersionsPage-cache-icon" size={16} aria-hidden="true"/><div data-ui-site="VersionsPage-cache-copy" className="versions-cache-copy"><strong data-ui-site="VersionsPage-cache-source">{t(catalog ? catalog.source === 'cache' ? 'downloads.localCache' : 'downloads.networkCatalog' : 'versionDownloads.notFetched')}</strong>{catalog && <span data-ui-site="VersionsPage-cache-time">{new Date(catalog.fetched_at * 1000).toLocaleString(i18n.resolvedLanguage)}{catalog.stale ? t('downloads.staleSuffix') : ''}</span>}</div><span data-ui-site="VersionsPage-count">{t('downloads.versionCount', { count: visible.length })}</span></div>
        {catalog?.warning && <p data-ui-site="VersionsPage-warning" className="versions-message" role="status">{catalog.warning}</p>}
        {error && <div data-ui-site="VersionsPage-error" className="versions-message is-error" role="alert"><span data-ui-site="VersionsPage-error-copy">{error}</span><button data-ui-site="VersionsPage-retry" className="text-button" disabled={busy} onClick={() => void a.catalog.refresh(true)}><RefreshCw data-ui-site="VersionsPage-retry-icon" size={15} aria-hidden="true"/>{t('common.retry')}</button></div>}
        <div data-ui-site="VersionsPage-list" className="versions-list">
          {visible.slice(0, limit).map(version => <UiIdentity key={version.id} namespace="version" value={version.id}><article data-ui-site="VersionsPage-version" className={'versions-row is-' + group(version.kind)}><div data-ui-site="VersionsPage-card-top" className="versions-name"><Box data-ui-site="VersionsPage-version-icon" size={19} aria-hidden="true"/><strong data-ui-site="VersionsPage-version-id">{version.id}</strong></div><span data-ui-site="VersionsPage-version-kind" className={'versions-tag is-' + group(version.kind)}>{t('versionDownloads.types.' + group(version.kind))}</span><button data-ui-site="VersionsPage-create" className="secondary small" disabled={blocked} onClick={() => a.profileDraft.openCreate(version.id)}><Plus data-ui-site="VersionsPage-create-icon" size={15} aria-hidden="true"/>{t('common.createInstance')}</button></article></UiIdentity>)}
          {!visible.length && <div data-ui-site="VersionsPage-empty" className="versions-empty"><Box data-ui-site="VersionsPage-empty-icon" size={30} aria-hidden="true"/><h3 data-ui-site="VersionsPage-empty-title">{t(versions.length ? 'downloads.noMatches' : busy ? 'downloads.loadingCatalog' : 'downloads.emptyTitle')}</h3><p data-ui-site="VersionsPage-empty-copy">{t(versions.length ? 'versionDownloads.changeFilters' : 'downloads.emptyDescription')}</p></div>}
        </div>
        <footer data-ui-site="VersionsPage-footer" className="versions-footer"><span data-ui-site="VersionsPage-shown">{t('versionDownloads.shown', { shown: Math.min(limit, visible.length), total: visible.length })}</span>{visible.length > limit && <button data-ui-site="VersionsPage-more" className="secondary small" onClick={() => setPagination({ key: paginationKey, limit: limit + PAGE_SIZE })}><ChevronDown data-ui-site="VersionsPage-more-icon" size={15} aria-hidden="true"/>{t('versionDownloads.loadMore')}</button>}</footer>
      </div>
    </div>
  </section>;
}
