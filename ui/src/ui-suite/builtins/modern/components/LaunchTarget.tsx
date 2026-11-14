import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';
import { Button, UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { resolveProfileEntry } from '../../common/lib/launcher-display';

export default function LaunchTarget() {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const button = useRef<HTMLButtonElement>(null), returnFocus = useRef(false), hadSelection = useRef(false);
  const entry = resolveProfileEntry(s, s.profiles.activeKey), profile = entry?.profile;
  const capability = entry && (entry.installed ? entry.capabilities.launch : entry.capabilities.install);
  const ownLaunch = !!profile && s.launch.profileKey === profile.instance_key && s.launch.phase !== 'idle';
  const action = ownLaunch ? s.launch.phase === 'running' ? 'shellHome.running' : s.launch.phase === 'cancelling' ? 'common.stopping' : 'shellHome.launching'
    : entry?.installing ? 'shellHome.installing' : s.launch.selection?.profileKey === profile?.instance_key ? 'shellHome.selectAccount'
    : entry?.installed ? 'common.launch' : entry?.actualInstance ? 'instancePages.repair' : 'common.install';
  useEffect(() => {
    if (s.launch.selection) {
      if (document.activeElement === button.current) returnFocus.current = true;
      hadSelection.current = true;
    }
    else if (s.launch.phase !== 'idle') { returnFocus.current = false; hadSelection.current = false; }
    else if (hadSelection.current && returnFocus.current && capability?.allowed) {
      const frame = requestAnimationFrame(() => { button.current?.focus(); returnFocus.current = false; hadSelection.current = false; });
      return () => cancelAnimationFrame(frame);
    }
  }, [s.launch.selection, s.launch.phase, capability?.allowed]);
  const content = <div className="current-launch-target" data-ui-site="ModernLaunchTarget-root">
    <div className="current-launch-copy" data-ui-site="ModernLaunchTarget-copy"><span data-ui-site="ModernLaunchTarget-label">{t('responsiveUi.currentLaunchTarget')}</span><strong title={profile?.name} data-ui-site="ModernLaunchTarget-name">{profile?.name ?? t('immersive.selectInstance')}</strong></div>
    <Button ref={button} className={profile ? 'primary' : 'secondary'} disabled={!!capability && !capability.allowed}
      aria-label={profile ? entry?.installed ? t('responsiveUi.launchNamed', { name: profile.name }) : `${t(action)} ${profile.name}` : t('immersive.selectInstance')}
      title={capability && !capability.allowed ? t(`shellHome.reasons.${capability.reason}`, { defaultValue: t('shellHome.restricted') }) : undefined}
      onClick={() => { if (profile) { returnFocus.current = !!entry?.installed; void (entry?.installed ? a.launch.request(profile.instance_key) : a.downloads.install(profile.instance_key)); } else a.navigation.navigate('instances'); }} data-ui-site="ModernLaunchTarget-action">
      <Play size={15} aria-hidden="true" data-ui-site="ModernLaunchTarget-icon"/>{t(profile ? action : 'immersive.selectInstance')}
    </Button>
  </div>;
  return profile ? <UiIdentity namespace="profile" value={profile.instance_key}>{content}</UiIdentity> : content;
}
