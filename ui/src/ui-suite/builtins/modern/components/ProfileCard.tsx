import { useTranslation } from 'react-i18next';
import { Box, Check, ChevronRight, MoreHorizontal, Play } from 'lucide-react';
import { Menu, UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { viewProps } from '../../common/lib/view';
import '../styles/instances.css';
type CardProps = { profileKey?: string; inspected?: boolean; onInspect?: (key: string) => void };
export default function ProfileCard(input?: CardProps & { props?: Readonly<Record<string, unknown>> }) {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const p = viewProps<CardProps>(input), key = p.profileKey;
  const entry = s.profiles.items.find(item => item.profile.instance_key === key);
  if (!entry || !key) return <p data-ui-site="ProfileCard-missing" className="instance-message">{t('instancePages.missing')}</p>;
  const { profile, actualInstance: actual, installed, capabilities } = entry;
  const current = s.profiles.activeKey === key, ownLaunch = s.launch.profileKey === key && s.launch.phase !== 'idle';
  const status = ownLaunch ? s.launch.phase === 'running' ? 'instancePages.running' : s.launch.phase === 'cancelling' ? 'common.stopping' : 'instancePages.launching'
    : s.launch.selection?.profileKey === key ? 'instancePages.selectAccount' : entry.installing ? 'instancePages.taskActive' : installed ? 'common.installed' : actual ? 'instancePages.filterStatus.repair' : 'common.notInstalled';
  const capability = installed ? capabilities.launch : capabilities.install;
  const reason = !capability.allowed ? t(`shellHome.reasons.${capability.reason}`, { defaultValue: t('shellHome.restricted') }) : '';
  const details = () => a.navigation.navigate('custom.instance-details', { profileKey: key });
  const mc = actual ? actual.game_version ?? t('common.unknown') : profile.game_version;
  const loader = actual ? actual.loader + ' ' + (actual.loader_version ?? '') : profile.loader + ' ' + profile.loader_version;
  return <UiIdentity namespace="profile" value={key}><article data-ui-site="ProfileCard-root" className={`instance-row modern-instance-row ${p.inspected ? 'inspected' : ''}`} data-profile-key={key}>
    <button data-ui-site="ProfileCard-view" className="instance-row-name" aria-label={t('instancePages.inspect', { name: profile.name })} aria-pressed={p.onInspect ? !!p.inspected : undefined} onClick={() => p.onInspect ? p.onInspect(key) : details()}><Box size={23} data-ui-site="ProfileCard-icon" /><span data-ui-site="ProfileCard-copy"><strong data-ui-site="ProfileCard-name" title={profile.name}>{profile.name}</strong><small data-ui-site="ProfileCard-key">{key}</small></span>{current && <Check data-ui-site="ProfileCard-current" size={15} aria-label={t('instancePages.current')} />}</button>
    <div data-ui-site="ProfileCard-version" className="instance-cell instance-version"><span data-ui-site="ProfileCard-version-label" className="instance-cell-label">Minecraft</span>{mc}</div>
    <div data-ui-site="ProfileCard-loader" className="instance-cell instance-loader"><span data-ui-site="ProfileCard-loader-label" className="instance-cell-label">{t(actual ? 'instancePages.actualLoader' : 'instancePages.targetLoader')}</span>{loader}</div>
    <div data-ui-site="ProfileCard-status" className="instance-cell instance-status"><span data-ui-site="ProfileCard-status-label" className="instance-cell-label">{t('instancePages.status')}</span><span data-ui-site="ProfileCard-status-value" className={`instance-tag ${actual && !installed ? 'needs-repair' : ''}`}>{t(status)}</span>{entry.activeTask && <small data-ui-site="ProfileCard-task-kind">{entry.activeTask.kind}</small>}</div>
    <div data-ui-site="ProfileCard-actions" className="instance-actions">
      <button data-ui-site="ProfileCard-launch" className="primary small" disabled={!capability.allowed} title={reason || undefined} onClick={() => void (installed ? a.launch.request(key) : a.downloads.install(key))}><Play data-ui-site="ProfileCard-launch-icon" size={14}/>{t(installed ? 'common.launch' : actual ? 'instancePages.repair' : 'common.install')}</button>
      <button data-ui-site="ProfileCard-details" className="secondary small instance-details-button" onClick={details} aria-label={t('instancePages.detailsFor', { name: profile.name })}>{t('shellHome.details')}<ChevronRight data-ui-site="ProfileCard-details-icon" size={14} /></button>
      <Menu.Root data-ui-site="ProfileCard-menu"><Menu.Trigger data-ui-site="ProfileCard-menu-trigger" className="icon-button" aria-label={t('instancePages.toolsFor', { name: profile.name })}><MoreHorizontal data-ui-site="ProfileCard-menu-icon" size={18}/></Menu.Trigger><Menu.Portal data-ui-site="ProfileCard-menu-portal"><Menu.Positioner data-ui-site="ProfileCard-menu-positioner" sideOffset={6} align="end" className="instance-menu-positioner"><Menu.Popup data-ui-site="ProfileCard-menu-popup" className="instance-tools-menu">
        <Menu.Item data-ui-site="ProfileCard-select" className="instance-menu-item" disabled={current} onClick={() => void a.profiles.select(key)}>{t(current ? 'instancePages.current' : 'instancePages.setCurrent')}</Menu.Item>
        <Menu.Item data-ui-site="ProfileCard-settings" className="instance-menu-item" disabled={!capabilities.edit.allowed} onClick={() => a.instanceDraft.open(key)}>{t('instances.settings')}</Menu.Item>
        <Menu.Item data-ui-site="ProfileCard-rename" className="instance-menu-item" disabled={!capabilities.edit.allowed} onClick={() => a.profileDraft.openRename(key)}>{t('instances.rename')}</Menu.Item>
        <Menu.Item data-ui-site="ProfileCard-repair" className="instance-menu-item" disabled={!capabilities.install.allowed} onClick={() => void a.downloads.install(key)}>{t('instances.installRepair')}</Menu.Item>
        <Menu.Item data-ui-site="ProfileCard-remove" className="instance-menu-item danger-text" disabled={!capabilities.remove.allowed} onClick={() => a.removal.open(key)}>{t('instances.remove')}</Menu.Item>
      </Menu.Popup></Menu.Positioner></Menu.Portal></Menu.Root>
    </div>
  </article></UiIdentity>;
}
