import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { viewProps } from '../../common/lib/view';

type IndicatorProps = { onFocusChange?: (focused: boolean) => void };
export default function DownloadIndicator(input?: IndicatorProps & { props?: Readonly<Record<string, unknown>> }) {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const { onFocusChange } = viewProps<IndicatorProps>(input), [focused, setFocused] = useState(false);
  const active = s.downloads.active || s.downloads.pending.length > 0;
  const count = s.downloads.tasks.filter(task => ['queued', 'running', 'cancelling'].includes(task.status)).length;
  const label = count > 0 ? t('downloadCenter.activeTasks', { count }) : active ? t('downloadCenter.preparing') : t('downloadCenter.taskRecords');
  useEffect(() => () => onFocusChange?.(false), [onFocusChange]);
  // Keep the actual focused button until blur when the last task finishes.
  if (!active && !focused) return null;
  return <button type="button" className="download-indicator" aria-label={label} title={label}
    data-state={active ? count > 0 ? 'active' : 'preparing' : 'finished'} data-active-count={count} data-ui-site="DownloadIndicator-root"
    onFocus={() => { setFocused(true); onFocusChange?.(true); }}
    onBlur={() => { setFocused(false); onFocusChange?.(false); }}
    onClick={() => a.navigation.navigate('downloads')}>
    <Download size={19} aria-hidden="true" data-ui-site="DownloadIndicator-icon"/>
    {count > 0 && <span className="download-indicator-count" aria-hidden="true" data-ui-site="DownloadIndicator-count">{count}</span>}
  </button>;
}
