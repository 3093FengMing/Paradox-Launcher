import '../styles/common.css';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder, Import, Layers, Plus, RefreshCw, Search } from 'lucide-react';
import { Panel } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import ProfileCard from '../components/ProfileCard';
import { sourceView } from '../lib/view';
const Card = sourceView('component.profile-card', ProfileCard);
function InstancesPage() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions(),
    config = snapshot.config.value;
  const search = snapshot.navigation.search,
    busy =
      !!snapshot.activity ||
      snapshot.settings.saving ||
      snapshot.downloads.active ||
      snapshot.downloads.pending.length > 0;
  const onSearch = actions.navigation.setSearch,
    onScan = actions.profiles.scan,
    onCreate = () => actions.profileDraft.openCreate(),
    onImport = actions.importDraft.open;
  if (!config) return null;
  const filteredProfiles = config.profiles.filter((profile) =>
    `${profile.name} ${profile.game_version}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Fragment data-ui-site="InstancesPage-1">
      <div className="toolbar" data-ui-site="InstancesPage-2">
        <div className="search" data-ui-site="InstancesPage-3">
          <Search size={17} data-ui-site="InstancesPage-4" />
          <input
            aria-label={t('instances.search')}
            placeholder={t('instances.searchPlaceholder')}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            data-ui-site="InstancesPage-5"
          />
        </div>
        <button
          className="secondary"
          onClick={() => {
            void onScan();
          }}
          data-ui-site="InstancesPage-6"
        >
          <RefreshCw size={16} data-ui-site="InstancesPage-7" />
          {t('instances.scan')}
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={onImport}
          data-ui-site="InstancesPage-8"
        >
          <Import size={16} data-ui-site="InstancesPage-9" />
          {t('instances.import')}
        </button>
      </div>
      <div className="profile-list" data-ui-site="InstancesPage-10">
        {snapshot.removal.residuals.map((issue) => (
          <Panel key={issue.token}>
            <strong>{t('removeDialog.residualTitle', { name: issue.name })}</strong>
            <p>{issue.error}</p>
            <code>{issue.instanceRoot}</code>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => actions.removal.openResidual(issue.token)}
            >
              {t('removeDialog.retryFiles')}
            </button>
          </Panel>
        ))}
        {filteredProfiles.map((profile) => (
          <Card
            key={profile.instance_key}
            profileKey={profile.instance_key}
            data-ui-site="InstancesPage-11"
          />
        ))}
      </div>
      {!config.profiles.length && (
        <EmptyState busy={busy} onCreate={onCreate} data-ui-site="InstancesPage-12" />
      )}
      {config.profiles.length > 0 && filteredProfiles.length === 0 && (
        <Panel className="empty-state" data-ui-site="InstancesPage-13">
          <Search data-ui-site="InstancesPage-14" />
          <h3 data-ui-site="InstancesPage-15">{t('instances.noMatches')}</h3>
          <p data-ui-site="InstancesPage-16">{t('instances.trySearch')}</p>
        </Panel>
      )}
      <Panel className="info-panel" data-ui-site="InstancesPage-17">
        <Folder size={19} data-ui-site="InstancesPage-18" />
        <div data-ui-site="InstancesPage-19">
          <strong data-ui-site="InstancesPage-20">{t('instances.storageTitle')}</strong>
          <p data-ui-site="InstancesPage-21">{t('instances.storageDescription')}</p>
          <code data-ui-site="InstancesPage-22">{config.settings.game_directory}</code>
        </div>
      </Panel>
    </Fragment>
  );
}
function DefaultEmptyState({ busy, onCreate }: { busy: boolean; onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <Panel className="empty-state compact-empty" data-ui-site="InstancesPage-23">
      <div className="empty-icon" data-ui-site="InstancesPage-24">
        <Layers size={27} data-ui-site="InstancesPage-25" />
      </div>
      <div data-ui-site="InstancesPage-26">
        <h3 data-ui-site="InstancesPage-27">{t('instances.emptyTitle')}</h3>
        <p data-ui-site="InstancesPage-28">{t('instances.emptyDescription')}</p>
      </div>
      <button
        className="secondary"
        disabled={busy}
        onClick={onCreate}
        data-ui-site="InstancesPage-29"
      >
        <Plus size={16} data-ui-site="InstancesPage-30" />
        {t('common.createInstance')}
      </button>
    </Panel>
  );
}
const EmptyState = sourceView('component.instances-empty-state', DefaultEmptyState);
export default InstancesPage;
