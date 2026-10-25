import { useTranslation } from 'react-i18next';
import {
  Box,
  Check,
  Download,
  MoreHorizontal,
  Play,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react';
import { Badge, Panel } from './ui';
import type { GameProfile } from '../types';

interface ProfileCardProps {
  profile: GameProfile;
  activeKey: string | null;
  installed: boolean;
  busy: boolean;
  queueActive: boolean;
  installing: boolean;
  desktop: boolean;
  onInstall: (profile: GameProfile) => void;
  onLaunch: (profile: GameProfile) => void;
  onSelect: (key: string) => void;
  onRename: (profile: GameProfile) => void;
  onSettings: (profile: GameProfile) => void;
  onRemove: (profile: GameProfile) => void;
}

export default function ProfileCard({
  profile,
  activeKey,
  installed,
  busy,
  queueActive,
  installing,
  desktop,
  onInstall,
  onLaunch,
  onSelect,
  onRename,
  onSettings,
  onRemove,
}: ProfileCardProps) {
  const { t } = useTranslation();
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
      <Badge muted={!installed}>
        {installed ? t('common.installed') : t('common.notInstalled')}
      </Badge>
      <div className="profile-actions">
        <button
          className="icon-button"
          title={t('instances.settings')}
          aria-label={t('instances.editLabel', { name: profile.name })}
          disabled={busy || queueActive}
          onClick={() => onSettings(profile)}
        >
          <Settings2 size={17} />
        </button>
        {installed && (
          <button
            className="icon-button"
            title={t('instances.installRepair')}
            aria-label={t('instances.repairLabel', { name: profile.name })}
            disabled={busy || installing || !desktop}
            onClick={() => onInstall(profile)}
          >
            <RefreshCw size={17} />
          </button>
        )}
        <button
          className="icon-button"
          title={t('instances.rename')}
          aria-label={t('instances.renameLabel', { name: profile.name })}
          disabled={busy || queueActive}
          onClick={() => onRename(profile)}
        >
          <MoreHorizontal size={20} />
        </button>
        <button
          className="secondary small"
          disabled={busy || queueActive}
          onClick={() => onSelect(profile.instance_key)}
        >
          {profile.instance_key === activeKey ? (
            <>
              <Check size={14} />
              {t('common.selected')}
            </>
          ) : (
            t('common.select')
          )}
        </button>
        <button
          className="primary small"
          disabled={busy || installing || (installed && queueActive) || !desktop}
          onClick={() => onLaunch(profile)}
        >
          {installed ? <Play size={14} /> : <Download size={14} />}
          {installing
            ? t('common.downloading')
            : installed
              ? t('common.launch')
              : t('common.install')}
        </button>
        <button
          className="icon-button"
          title={t('instances.remove')}
          aria-label={t('instances.removeLabel', { name: profile.name })}
          disabled={busy || queueActive}
          onClick={() => onRemove(profile)}
        >
          <Trash2 size={17} />
        </button>
      </div>
    </Panel>
  );
}
