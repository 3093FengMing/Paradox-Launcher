import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Folder, Import, Layers, Plus, RefreshCw, Search } from 'lucide-react';
import { Panel } from '../components/ui';
import type { AppConfig, GameProfile } from '../types';

interface InstancesPageProps {
  config: AppConfig;
  search: string;
  busy: boolean;
  renderProfile: (profile: GameProfile) => ReactNode;
  onSearch: (value: string) => void;
  onScan: () => void;
  onCreate: () => void;
  onImport: () => void;
}

export default function InstancesPage({
  config,
  search,
  busy,
  renderProfile,
  onSearch,
  onScan,
  onCreate,
  onImport,
}: InstancesPageProps) {
  const { t } = useTranslation();
  const filteredProfiles = config.profiles.filter((profile) =>
    `${profile.name} ${profile.game_version}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            aria-label={t('instances.search')}
            placeholder={t('instances.searchPlaceholder')}
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
        <button className="secondary" onClick={() => onScan()}>
          <RefreshCw size={16} />
          {t('instances.scan')}
        </button>
        <button className="secondary" disabled={busy} onClick={onImport}>
          <Import size={16} />
          {t('instances.import')}
        </button>
      </div>
      <div className="profile-list">{filteredProfiles.map(renderProfile)}</div>
      {!config.profiles.length && <EmptyState busy={busy} onCreate={onCreate} />}
      {config.profiles.length > 0 && filteredProfiles.length === 0 && (
        <Panel className="empty-state">
          <Search />
          <h3>{t('instances.noMatches')}</h3>
          <p>{t('instances.trySearch')}</p>
        </Panel>
      )}
      <Panel className="info-panel">
        <Folder size={19} />
        <div>
          <strong>{t('instances.storageTitle')}</strong>
          <p>{t('instances.storageDescription')}</p>
          <code>{config.settings.game_directory}</code>
        </div>
      </Panel>
    </>
  );
}

function EmptyState({ busy, onCreate }: { busy: boolean; onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <Panel className="empty-state compact-empty">
      <div className="empty-icon">
        <Layers size={27} />
      </div>
      <div>
        <h3>{t('instances.emptyTitle')}</h3>
        <p>{t('instances.emptyDescription')}</p>
      </div>
      <button className="secondary" disabled={busy} onClick={onCreate}>
        <Plus size={16} />
        {t('common.createInstance')}
      </button>
    </Panel>
  );
}
