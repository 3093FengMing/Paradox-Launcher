import type { ReactNode } from 'react';
import { Folder, Layers, Plus, RefreshCw, Search } from 'lucide-react';
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
}

export default function InstancesPage({
  config,
  search,
  busy,
  renderProfile,
  onSearch,
  onScan,
  onCreate,
}: InstancesPageProps) {
  const filteredProfiles = config.profiles.filter((profile) =>
    `${profile.name} ${profile.game_version}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            aria-label="搜索实例"
            placeholder="搜索实例名称或游戏版本…"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
        <button className="secondary" onClick={() => onScan()}>
          <RefreshCw size={16} />
          扫描本地
        </button>
      </div>
      <div className="profile-list">{filteredProfiles.map(renderProfile)}</div>
      {!config.profiles.length && <EmptyState busy={busy} onCreate={onCreate} />}
      {config.profiles.length > 0 && filteredProfiles.length === 0 && (
        <Panel className="empty-state">
          <Search />
          <h3>没有匹配的实例</h3>
          <p>试试其他名称或版本号。</p>
        </Panel>
      )}
      <Panel className="info-panel">
        <Folder size={19} />
        <div>
          <strong>共享资源，独立世界</strong>
          <p>每个实例拥有独立的存档与配置，游戏资源由 Elemental 统一管理。</p>
          <code>{config.settings.game_directory}</code>
        </div>
      </Panel>
    </>
  );
}

function EmptyState({ busy, onCreate }: { busy: boolean; onCreate: () => void }) {
  return (
    <Panel className="empty-state compact-empty">
      <div className="empty-icon">
        <Layers size={27} />
      </div>
      <div>
        <h3>你的冒险，尚待开启</h3>
        <p>创建第一个实例，让这个空间成为你的世界。</p>
      </div>
      <button className="secondary" disabled={busy} onClick={onCreate}>
        <Plus size={16} />
        创建实例
      </button>
    </Panel>
  );
}
