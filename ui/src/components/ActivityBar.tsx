import { ArrowRight, Gamepad2, LoaderCircle, Square } from 'lucide-react';
import type { Activity } from '../types';

interface ActivityBarProps {
  activity: Activity;
  onStop: () => void;
  onLogs: () => void;
}

export default function ActivityBar({ activity, onStop, onLogs }: ActivityBarProps) {
  const running = activity.action === 'launch' && activity.status === 'running';
  return (
    <div className="activity-bar" role="status">
      {running ? <Gamepad2 size={18} /> : <LoaderCircle className="spin" size={18} />}
      <span>{activity.message}</span>
      {running && (
        <button className="secondary small" onClick={onStop}>
          <Square size={13} />
          停止游戏
        </button>
      )}
      <button className="text-button" onClick={onLogs}>
        查看日志
        <ArrowRight size={14} />
      </button>
    </div>
  );
}
