import { useTranslation } from 'react-i18next';
import { Box, Download, Layers, Plus, RefreshCw, Search } from 'lucide-react';
import { Badge, Panel } from '../components/ui';
import type { CatalogSnapshot, GameVersion } from '../types';
import type { ReactNode } from 'react';

interface DownloadsPageProps {
  versions: GameVersion[];
  search: string;
  showSnapshots: boolean;
  busy: boolean;
  catalogBusy: boolean;
  catalogError: string;
  catalogSnapshot: CatalogSnapshot | null;
  queue: ReactNode;
  onSearch: (value: string) => void;
  onRefresh: () => void;
  onCreate: (version?: string) => void;
  onSnapshotsChange: (value: boolean) => void;
}

export default function DownloadsPage({
  versions,
  search,
  showSnapshots,
  busy,
  catalogBusy,
  catalogError,
  catalogSnapshot,
  queue,
  onSearch,
  onRefresh,
  onCreate,
  onSnapshotsChange,
}: DownloadsPageProps) {
  const { t, i18n } = useTranslation();
  const visibleVersions = versions.filter(
    (version) =>
      (showSnapshots || version.kind === 'release') &&
      version.id.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      {queue}
      <div className="section-heading">
        <h2>{t('downloads.catalog')}</h2>
      </div>
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            aria-label={t('downloads.search')}
            placeholder={t('downloads.searchPlaceholder')}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
        <button className="secondary" disabled={catalogBusy} onClick={() => onRefresh()}>
          <RefreshCw className={catalogBusy ? 'spin' : ''} size={16} />
          {catalogBusy ? t('downloads.fetching') : t('downloads.refresh')}
        </button>
      </div>
      <div className="filter-row">
        <Badge>{t('common.vanilla')}</Badge>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={showSnapshots}
            disabled={!!busy}
            onChange={(event) => onSnapshotsChange(event.target.checked)}
          />
          {t('downloads.showSnapshots')}
        </label>
        <small>{t('downloads.versionCount', { count: visibleVersions.length })}</small>
      </div>
      {catalogSnapshot && (
        <p>
          {catalogSnapshot.source === 'cache'
            ? t('downloads.localCache')
            : t('downloads.networkCatalog')}{' '}
          · {new Date(catalogSnapshot.fetched_at * 1000).toLocaleString(i18n.resolvedLanguage)}
          {catalogSnapshot.stale ? t('downloads.staleSuffix') : ''}
        </p>
      )}
      {catalogSnapshot?.warning && <div className="error-banner">{catalogSnapshot.warning}</div>}
      {catalogError && (
        <div className="error-banner">
          {catalogError}
          <button className="text-button" onClick={() => onRefresh()}>
            {t('common.retry')}
          </button>
        </div>
      )}
      {!versions.length ? (
        <Panel className="empty-state">
          <Download size={36} />
          <h3>{catalogBusy ? t('downloads.loadingCatalog') : t('downloads.emptyTitle')}</h3>
          <p>{t('downloads.emptyDescription')}</p>
          <button className="primary" disabled={catalogBusy} onClick={() => onRefresh()}>
            <RefreshCw size={16} />
            {t('downloads.fetch')}
          </button>
          <button className="text-button" disabled={!!busy} onClick={() => onCreate()}>
            {t('downloads.enterVersion')}
          </button>
        </Panel>
      ) : (
        <Panel className="version-list">
          <div className="table-heading">
            <span>{t('common.minecraftVersion')}</span>
            <span>{t('downloads.type')}</span>
            <span>{t('downloads.actions')}</span>
          </div>
          {visibleVersions.slice(0, 100).map((version) => (
            <div className="version-row" key={version.id}>
              <div>
                <div className="version-icon">
                  <Box size={19} />
                </div>
                <strong>{version.id}</strong>
              </div>
              <Badge muted={version.kind !== 'release'}>
                {version.kind === 'release'
                  ? t('downloads.release')
                  : version.kind === 'snapshot'
                    ? t('downloads.snapshot')
                    : t('downloads.historical')}
              </Badge>
              <button
                className="secondary small"
                disabled={!!busy}
                onClick={() => onCreate(version.id)}
              >
                <Plus size={14} />
                {t('common.createInstance')}
              </button>
            </div>
          ))}
          {visibleVersions.length > 100 && <p className="list-note">{t('downloads.listLimit')}</p>}
          {!visibleVersions.length && <p className="list-note">{t('downloads.noMatches')}</p>}
        </Panel>
      )}
      <Panel className="info-panel">
        <Layers size={19} />
        <div>
          <strong>{t('downloads.loadersTitle')}</strong>
          <p>{t('downloads.loadersDescription')}</p>
        </div>
      </Panel>
    </>
  );
}
