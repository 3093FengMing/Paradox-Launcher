import { useTranslation } from 'react-i18next';
import { Gamepad2, LoaderCircle, Square } from 'lucide-react';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { resolveProfileEntry } from '../../common/lib/launcher-display';
import { translateRuntimeMessage } from '../../common/lib/runtime-message';
export default function ActivityBar() {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const phase = s.launch.phase, launch = phase !== 'idle';
  const owner = resolveProfileEntry(s, s.launch.profileKey);
  if (!launch && !s.activity) return null;
  const state = t(phase === 'running' ? 'shellHome.running' : phase === 'cancelling' ? 'common.stopping' : 'shellHome.launching');
  return <div data-ui-site="ActivityBar-1" className="activity-bar" role="status" data-launch-owner={s.launch.profileKey ?? 'unknown'}>
    {phase === 'running' ? <Gamepad2 data-ui-site="ActivityBar-2" size={18} /> : <LoaderCircle data-ui-site="ActivityBar-3" className="spin" size={18} />}
    <span data-ui-site="ActivityBar-4">{launch ? t(owner ? 'shellHome.ownedActivity' : 'shellHome.globalActivity', { name: owner?.profile.name, state }) : translateRuntimeMessage(s.activity!.message, t)}</span>
    {launch && <button data-ui-site="ActivityBar-5" className="secondary small" disabled={!s.launch.canStop} onClick={() => void a.launch.stop()}>
      <Square data-ui-site="ActivityBar-6" size={12} />{t(phase === 'cancelling' ? 'common.stopping' : phase === 'running' ? 'common.stopGame' : 'common.cancelLaunch')}
    </button>}
    {s.navigation.routes.some(r => r.id === 'logs' && r.navigation) && <button data-ui-site="ActivityBar-7" className="text-button" onClick={() => a.navigation.navigate('logs')}>{t('activity.viewLogs')}</button>}
  </div>;
}
