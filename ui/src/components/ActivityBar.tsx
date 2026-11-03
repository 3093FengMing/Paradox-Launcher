import { customComponent } from '../customization/Customizable';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Gamepad2, LoaderCircle, Square } from 'lucide-react';
import type { Activity } from '../types';
import { translateRuntimeMessage } from '../i18n';
import { canStopLaunch, isCancelling, isLaunchActive } from '../lib/activity';

interface ActivityBarProps {
  activity: Activity;
  onStop: () => void;
  onLogs: () => void;
}

function ActivityBar({ activity, onStop, onLogs }: ActivityBarProps) {
  const { t } = useTranslation();
  const running = activity.action === 'launch' && activity.status === 'running';
  const cancelling = isCancelling(activity);
  return (
    <div className="activity-bar" role="status">
      {running ? <Gamepad2 size={18} /> : <LoaderCircle className="spin" size={18} />}
      <span>{translateRuntimeMessage(activity.message)}</span>
      {isLaunchActive(activity) && (
        <button className="secondary small" disabled={!canStopLaunch(activity)} onClick={onStop}>
          <Square size={13} />
          {t(cancelling ? 'common.stopping' : running ? 'common.stopGame' : 'common.cancelLaunch')}
        </button>
      )}
      <button className="text-button" onClick={onLogs}>
        {t('activity.viewLogs')}
        <ArrowRight size={14} />
      </button>
    </div>
  );
}

const CustomizedActivityBar = customComponent('component.activity-bar', ActivityBar);
export default CustomizedActivityBar;
