import '../styles/common.css';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Download, Layers, Plus, RefreshCw, Search } from 'lucide-react';
import { Badge, Panel } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import DownloadQueue from '../components/DownloadQueue';
import { sourceView } from '../lib/view';
const Queue = sourceView('component.download-queue', DownloadQueue);
function DownloadsPage() {
  const { t, i18n } = useTranslation();
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions();
  const {
    versions,
    busy: catalogBusy,
    error: catalogError,
    snapshot: catalogSnapshot,
  } = snapshot.catalog;
  const search = snapshot.navigation.search,
    showSnapshots = snapshot.config.value?.settings.show_snapshots ?? false;
  const busy =
    !!snapshot.activity ||
    snapshot.settings.saving ||
    snapshot.downloads.active ||
    snapshot.downloads.pending.length > 0;
  const onSearch = actions.navigation.setSearch,
    onRefresh = () => {
      void actions.catalog.refresh(true);
    },
    onCreate = actions.profileDraft.openCreate,
    onSnapshotsChange = (value: boolean) => {
      void actions.catalog.setSnapshots(value);
    };
  const visibleVersions = versions.filter(
    (version) =>
      (showSnapshots || version.kind === 'release') &&
      version.id.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Fragment data-ui-site="DownloadsPage-1">
      <Queue data-ui-site="DownloadsPage-2" />
      <div className="section-heading" data-ui-site="DownloadsPage-3">
        <h2 data-ui-site="DownloadsPage-4">{t('downloads.catalog')}</h2>
      </div>
      <div className="toolbar" data-ui-site="DownloadsPage-5">
        <div className="search" data-ui-site="DownloadsPage-6">
          <Search size={17} data-ui-site="DownloadsPage-7" />
          <input
            aria-label={t('downloads.search')}
            placeholder={t('downloads.searchPlaceholder')}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            data-ui-site="DownloadsPage-8"
          />
        </div>
        <button
          className="secondary"
          disabled={catalogBusy}
          onClick={() => onRefresh()}
          data-ui-site="DownloadsPage-9"
        >
          <RefreshCw
            className={catalogBusy ? 'spin' : ''}
            size={16}
            data-ui-site="DownloadsPage-10"
          />
          {catalogBusy ? t('downloads.fetching') : t('downloads.refresh')}
        </button>
      </div>
      <div className="filter-row" data-ui-site="DownloadsPage-11">
        <Badge data-ui-site="DownloadsPage-12">{t('common.vanilla')}</Badge>
        <label className="inline-check" data-ui-site="DownloadsPage-13">
          <input
            type="checkbox"
            checked={showSnapshots}
            disabled={!!busy}
            onChange={(event) => onSnapshotsChange(event.target.checked)}
            data-ui-site="DownloadsPage-14"
          />
          {t('downloads.showSnapshots')}
        </label>
        <small data-ui-site="DownloadsPage-15">
          {t('downloads.versionCount', { count: visibleVersions.length })}
        </small>
      </div>
      {catalogSnapshot && (
        <p data-ui-site="DownloadsPage-16">
          {catalogSnapshot.source === 'cache'
            ? t('downloads.localCache')
            : t('downloads.networkCatalog')}{' '}
          · {new Date(catalogSnapshot.fetched_at * 1000).toLocaleString(i18n.resolvedLanguage)}
          {catalogSnapshot.stale ? t('downloads.staleSuffix') : ''}
        </p>
      )}
      {catalogSnapshot?.warning && (
        <div className="error-banner" data-ui-site="DownloadsPage-17">
          {catalogSnapshot.warning}
        </div>
      )}
      {catalogError && (
        <div className="error-banner" data-ui-site="DownloadsPage-18">
          {catalogError}
          <button
            className="text-button"
            onClick={() => onRefresh()}
            data-ui-site="DownloadsPage-19"
          >
            {t('common.retry')}
          </button>
        </div>
      )}
      {!versions.length ? (
        <Panel className="empty-state" data-ui-site="DownloadsPage-20">
          <Download size={36} data-ui-site="DownloadsPage-21" />
          <h3 data-ui-site="DownloadsPage-22">
            {catalogBusy ? t('downloads.loadingCatalog') : t('downloads.emptyTitle')}
          </h3>
          <p data-ui-site="DownloadsPage-23">{t('downloads.emptyDescription')}</p>
          <button
            className="primary"
            disabled={catalogBusy}
            onClick={() => onRefresh()}
            data-ui-site="DownloadsPage-24"
          >
            <RefreshCw size={16} data-ui-site="DownloadsPage-25" />
            {t('downloads.fetch')}
          </button>
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() => onCreate()}
            data-ui-site="DownloadsPage-26"
          >
            {t('downloads.enterVersion')}
          </button>
        </Panel>
      ) : (
        <Panel className="version-list" data-ui-site="DownloadsPage-27">
          <div className="table-heading" data-ui-site="DownloadsPage-28">
            <span data-ui-site="DownloadsPage-29">{t('common.minecraftVersion')}</span>
            <span data-ui-site="DownloadsPage-30">{t('downloads.type')}</span>
            <span data-ui-site="DownloadsPage-31">{t('downloads.actions')}</span>
          </div>
          {visibleVersions.slice(0, 100).map((version) => (
            <div className="version-row" key={version.id} data-ui-site="DownloadsPage-32">
              <div data-ui-site="DownloadsPage-33">
                <div className="version-icon" data-ui-site="DownloadsPage-34">
                  <Box size={19} data-ui-site="DownloadsPage-35" />
                </div>
                <strong data-ui-site="DownloadsPage-36">{version.id}</strong>
              </div>
              <Badge muted={version.kind !== 'release'} data-ui-site="DownloadsPage-37">
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
                data-ui-site="DownloadsPage-38"
              >
                <Plus size={14} data-ui-site="DownloadsPage-39" />
                {t('common.createInstance')}
              </button>
            </div>
          ))}
          {visibleVersions.length > 100 && (
            <p className="list-note" data-ui-site="DownloadsPage-40">
              {t('downloads.listLimit')}
            </p>
          )}
          {!visibleVersions.length && (
            <p className="list-note" data-ui-site="DownloadsPage-41">
              {t('downloads.noMatches')}
            </p>
          )}
        </Panel>
      )}
      <Panel className="info-panel" data-ui-site="DownloadsPage-42">
        <Layers size={19} data-ui-site="DownloadsPage-43" />
        <div data-ui-site="DownloadsPage-44">
          <strong data-ui-site="DownloadsPage-45">{t('downloads.loadersTitle')}</strong>
          <p data-ui-site="DownloadsPage-46">{t('downloads.loadersDescription')}</p>
        </div>
      </Panel>
    </Fragment>
  );
}
export default DownloadsPage;
