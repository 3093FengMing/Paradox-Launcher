import '../styles/common.css';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Gamepad2, LoaderCircle, Square } from 'lucide-react';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { translateRuntimeMessage } from '../lib/runtime-message';
function ActivityBar() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions(),
    activity = snapshot.activity;
  const running = snapshot.launch.phase === 'running',
    cancelling = snapshot.launch.phase === 'cancelling';
  const onStop = () => {
      void actions.launch.stop();
    },
    onLogs = () => actions.navigation.navigate('logs');
  if (!activity) return null;
  return (
    <div className="activity-bar" role="status" data-ui-site="ActivityBar-1">
      {running ? (
        <Gamepad2 size={18} data-ui-site="ActivityBar-2" />
      ) : (
        <LoaderCircle className="spin" size={18} data-ui-site="ActivityBar-3" />
      )}
      <span data-ui-site="ActivityBar-4">{translateRuntimeMessage(activity.message, t)}</span>
      {snapshot.launch.phase !== 'idle' && (
        <button
          className="secondary small"
          disabled={!snapshot.launch.canStop}
          onClick={onStop}
          data-ui-site="ActivityBar-5"
        >
          <Square size={13} data-ui-site="ActivityBar-6" />
          {t(cancelling ? 'common.stopping' : running ? 'common.stopGame' : 'common.cancelLaunch')}
        </button>
      )}
      <button className="text-button" onClick={onLogs} data-ui-site="ActivityBar-7">
        {t('activity.viewLogs')}
        <ArrowRight size={14} data-ui-site="ActivityBar-8" />
      </button>
    </div>
  );
}
export default ActivityBar;
