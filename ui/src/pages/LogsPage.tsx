import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, Terminal } from 'lucide-react';
import { Panel } from '../components/ui';
import { exportLogs } from '../lib/download';
import type { LogLine } from '../types';

interface LogsPageProps {
  logs: LogLine[];
  busy: boolean;
  onClear: () => void;
}

export default function LogsPage({ logs, busy, onClear }: LogsPageProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="toolbar">
        <div className="log-status">
          <span className="status-dot" />
          {busy ? t('logs.running') : t('logs.waiting')}
          <small>{t('logs.count', { count: logs.length })}</small>
        </div>
        <div className="button-group">
          <button className="secondary" onClick={() => exportLogs(logs)}>
            <ArrowDownToLine size={16} />
            {t('common.export')}
          </button>
          <button className="secondary" onClick={onClear}>
            {t('logs.clear')}
          </button>
        </div>
      </div>
      <Panel className="console">
        <div className="console-header">
          <Terminal size={16} />
          <span>LAUNCHER CONSOLE</span>
          <div>
            <i />
            <i />
            <i />
          </div>
        </div>
        {logs.length ? (
          logs.map((line, index) => (
            <div className={`log-line ${line.level}`} key={index}>
              <time>{line.time}</time>
              <b>{line.level.toUpperCase()}</b>
              <span>{line.message}</span>
            </div>
          ))
        ) : (
          <div className="console-empty">
            <Terminal size={30} />
            <p>{t('logs.emptyTitle')}</p>
            <small>{t('logs.emptyDescription')}</small>
          </div>
        )}
      </Panel>
    </>
  );
}
