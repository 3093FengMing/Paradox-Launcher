import { useTranslation } from 'react-i18next';
import { ArrowRight, Gamepad2, LoaderCircle, Square } from 'lucide-react';
import type { Activity } from '../types';
import { translateRuntimeMessage } from '../i18n';

interface ActivityBarProps {
  activity: Activity;
  onStop: () => void;
  onLogs: () => void;
}

export default function ActivityBar({ activity, onStop, onLogs }: ActivityBarProps) {
  const { t } = useTranslation();
  const running = activity.action === 'launch' && activity.status === 'running';
  return (
    <div className="activity-bar" role="status">
      {running ? <Gamepad2 size={18} /> : <LoaderCircle className="spin" size={18} />}
      <span>{translateRuntimeMessage(activity.message)}</span>
      {running && (
        <button className="secondary small" onClick={onStop}>
          <Square size={13} />
          {t('common.stopGame')}
        </button>
      )}
      <button className="text-button" onClick={onLogs}>
        {t('activity.viewLogs')}
        <ArrowRight size={14} />
      </button>
    </div>
  );
}
