import { Box, Check, Download, MoreHorizontal, Play, RefreshCw } from 'lucide-react';
import { Badge, Panel } from './ui';
import type { GameProfile } from '../types';

interface ProfileCardProps {
  profile: GameProfile;
  activeKey: string | null;
  installed: boolean;
  busy: boolean;
  desktop: boolean;
  onInstall: (profile: GameProfile) => void;
  onLaunch: (profile: GameProfile) => void;
  onSelect: (key: string) => void;
  onRename: (profile: GameProfile) => void;
}

export default function ProfileCard({
  profile,
  activeKey,
  installed,
  busy,
  desktop,
  onInstall,
  onLaunch,
  onSelect,
  onRename,
}: ProfileCardProps) {
  return (
    <Panel
      className={`profile-card ${profile.instance_key === activeKey ? 'selected' : ''}`}
      key={profile.instance_key}
    >
      <div className="profile-icon">
        <Box size={25} />
      </div>
      <div className="profile-info">
        <h3>{profile.name}</h3>
        <p>
          Minecraft {profile.game_version} <span>·</span> Vanilla
        </p>
      </div>
      <Badge muted={!installed}>{installed ? '已安装' : '待安装'}</Badge>
      <div className="profile-actions">
        {installed && (
          <button
            className="icon-button"
            title="安装 / 修复"
            aria-label={`安装 / 修复 ${profile.name}`}
            disabled={busy || !desktop}
            onClick={() => onInstall(profile)}
          >
            <RefreshCw size={17} />
          </button>
        )}
        <button
          className="icon-button"
          title="重命名实例"
          aria-label={`重命名 ${profile.name}`}
          disabled={busy}
          onClick={() => onRename(profile)}
        >
          <MoreHorizontal size={20} />
        </button>
        <button
          className="secondary small"
          disabled={busy}
          onClick={() => onSelect(profile.instance_key)}
        >
          {profile.instance_key === activeKey ? (
            <>
              <Check size={14} />
              已选中
            </>
          ) : (
            '选择'
          )}
        </button>
        <button
          className="primary small"
          disabled={busy || !desktop}
          onClick={() => onLaunch(profile)}
        >
          {installed ? <Play size={14} /> : <Download size={14} />}
          {installed ? '启动' : '安装'}
        </button>
      </div>
    </Panel>
  );
}
