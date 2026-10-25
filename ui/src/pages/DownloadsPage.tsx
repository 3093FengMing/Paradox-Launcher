import { Box, Download, Layers, Plus, RefreshCw, Search } from 'lucide-react';
import { Badge, Panel } from '../components/ui';
import type { GameVersion } from '../types';

interface DownloadsPageProps {
  versions: GameVersion[];
  search: string;
  showSnapshots: boolean;
  busy: boolean;
  catalogBusy: boolean;
  catalogError: string;
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
  onSearch,
  onRefresh,
  onCreate,
  onSnapshotsChange,
}: DownloadsPageProps) {
  const visibleVersions = versions.filter(
    (version) =>
      (showSnapshots || version.kind === 'release') &&
      version.id.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search size={17} />
          <input
            aria-label="搜索版本"
            placeholder="搜索游戏版本，例如 1.21.1…"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
        <button className="secondary" disabled={catalogBusy} onClick={() => onRefresh()}>
          <RefreshCw className={catalogBusy ? 'spin' : ''} size={16} />
          {catalogBusy ? '获取中' : '刷新版本'}
        </button>
      </div>
      <div className="filter-row">
        <Badge>Vanilla 原版</Badge>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={showSnapshots}
            disabled={!!busy}
            onChange={(event) => onSnapshotsChange(event.target.checked)}
          />
          显示快照与历史版本
        </label>
        <small>{visibleVersions.length} 个版本</small>
      </div>
      {catalogError && (
        <div className="error-banner">
          {catalogError}
          <button className="text-button" onClick={() => onRefresh()}>
            重试
          </button>
        </div>
      )}
      {!versions.length ? (
        <Panel className="empty-state">
          <Download size={36} />
          <h3>{catalogBusy ? '正在获取版本目录' : '探索你的下一个世界'}</h3>
          <p>从 Mojang 获取真实版本列表，或直接输入版本号创建实例。</p>
          <button className="primary" disabled={catalogBusy} onClick={() => onRefresh()}>
            <RefreshCw size={16} />
            获取版本目录
          </button>
          <button className="text-button" disabled={!!busy} onClick={() => onCreate()}>
            手动输入版本号
          </button>
        </Panel>
      ) : (
        <Panel className="version-list">
          <div className="table-heading">
            <span>MINECRAFT 版本</span>
            <span>类型</span>
            <span>操作</span>
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
                  ? '正式版'
                  : version.kind === 'snapshot'
                    ? '快照'
                    : '历史版本'}
              </Badge>
              <button
                className="secondary small"
                disabled={!!busy}
                onClick={() => onCreate(version.id)}
              >
                <Plus size={14} />
                创建实例
              </button>
            </div>
          ))}
          {visibleVersions.length > 100 && (
            <p className="list-note">显示前 100 项，使用搜索查找其他版本。</p>
          )}
          {!visibleVersions.length && <p className="list-note">没有匹配的版本。</p>}
        </Panel>
      )}
      <Panel className="info-panel">
        <Layers size={19} />
        <div>
          <strong>模组加载器即将加入</strong>
          <p>Fabric、Forge、NeoForge 和 Quilt 已列入开发路线。当前界面只开放原版流程。</p>
        </div>
      </Panel>
    </>
  );
}
