import '../styles/common.css';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Check,
  Download,
  MoreHorizontal,
  Puzzle,
  Play,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react';
import { Badge, Panel } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { viewProps } from '../lib/view';
function ProfileCard(input?: { profileKey?: string; props?: Readonly<Record<string, unknown>> }) {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions();
  const identity = viewProps<{
      profileKey?: string;
    }>(input),
    entry = snapshot.profiles.items.find(
      (item) => item.profile.instance_key === identity.profileKey,
    );
  if (!entry) return null;
  const { profile, installed, actualInstance, installing, capabilities } = entry,
    activeKey = snapshot.profiles.activeKey;
  const onInstall = () => {
      void actions.downloads.install(profile.instance_key);
    },
    onLaunch = () => {
      void (installed
        ? actions.launch.request(profile.instance_key)
        : actions.downloads.install(profile.instance_key));
    },
    onSelect = () => {
      void actions.profiles.select(profile.instance_key);
    };
  const onRename = () => actions.profileDraft.openRename(profile.instance_key),
    onSettings = () => actions.instanceDraft.open(profile.instance_key),
    onRemove = () => actions.removal.open(profile.instance_key);
  const onManageMods = () => {
    actions.content.selectProfile(profile.instance_key);
    actions.navigation.navigate('content', { profileKey: profile.instance_key });
  };
  return (
    <Panel
      className={`profile-card ${profile.instance_key === activeKey ? 'selected' : ''}`}
      key={profile.instance_key}
      data-ui-site="ProfileCard-1"
    >
      <div className="profile-icon" data-ui-site="ProfileCard-2">
        <Box size={25} data-ui-site="ProfileCard-3" />
      </div>
      <div className="profile-info" data-ui-site="ProfileCard-4">
        <h3 data-ui-site="ProfileCard-5">{profile.name}</h3>
        <p data-ui-site="ProfileCard-6">
          Minecraft {profile.game_version} <span data-ui-site="ProfileCard-7">·</span>{' '}
          {profile.loader === 'vanilla' ? 'Vanilla' : `${profile.loader} ${profile.loader_version}`}
        </p>
        {actualInstance && (
          <p className="help-text" data-ui-site="ProfileCard-8">
            {t('loaders.installedDriver', {
              game: actualInstance.game_version ?? t('common.unknown'),
              loader: actualInstance.loader,
              version: actualInstance.loader_version ?? '',
            })}
            {!installed && (
              <span data-ui-site="ProfileCard-9"> · {t('loaders.repairRequired')}</span>
            )}
          </p>
        )}
      </div>
      <Badge muted={!installed} data-ui-site="ProfileCard-10">
        {installed ? t('common.installed') : t('common.notInstalled')}
      </Badge>
      <div className="profile-actions" data-ui-site="ProfileCard-11">
        <button
          className="icon-button"
          title={t('loaders.manageMods')}
          aria-label={t('loaders.manageModsLabel', { name: profile.name })}
          onClick={onManageMods}
          data-ui-site="ProfileCard-12"
        >
          <Puzzle size={17} data-ui-site="ProfileCard-13" />
        </button>
        <button
          className="icon-button"
          title={t('instances.settings')}
          aria-label={t('instances.editLabel', { name: profile.name })}
          disabled={!capabilities.edit.allowed}
          onClick={() => onSettings()}
          data-ui-site="ProfileCard-14"
        >
          <Settings2 size={17} data-ui-site="ProfileCard-15" />
        </button>
        {installed && (
          <button
            className="icon-button"
            title={t('instances.installRepair')}
            aria-label={t('instances.repairLabel', { name: profile.name })}
            disabled={!capabilities.install.allowed}
            onClick={() => onInstall()}
            data-ui-site="ProfileCard-16"
          >
            <RefreshCw size={17} data-ui-site="ProfileCard-17" />
          </button>
        )}
        <button
          className="icon-button"
          title={t('instances.rename')}
          aria-label={t('instances.renameLabel', { name: profile.name })}
          disabled={!capabilities.edit.allowed}
          onClick={() => onRename()}
          data-ui-site="ProfileCard-18"
        >
          <MoreHorizontal size={20} data-ui-site="ProfileCard-19" />
        </button>
        <button
          className="secondary small"
          disabled={!capabilities.edit.allowed}
          onClick={() => onSelect()}
          data-ui-site="ProfileCard-20"
        >
          {profile.instance_key === activeKey ? (
            <Fragment data-ui-site="ProfileCard-21">
              <Check size={14} data-ui-site="ProfileCard-22" />
              {t('common.selected')}
            </Fragment>
          ) : (
            t('common.select')
          )}
        </button>
        <button
          className="primary small"
          disabled={!(installed ? capabilities.launch.allowed : capabilities.install.allowed)}
          onClick={() => onLaunch()}
          data-ui-site="ProfileCard-23"
        >
          {installed ? (
            <Play size={14} data-ui-site="ProfileCard-24" />
          ) : (
            <Download size={14} data-ui-site="ProfileCard-25" />
          )}
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
          disabled={!capabilities.remove.allowed}
          onClick={() => onRemove()}
          data-ui-site="ProfileCard-26"
        >
          <Trash2 size={17} data-ui-site="ProfileCard-27" />
        </button>
      </div>
    </Panel>
  );
}
export default ProfileCard;
