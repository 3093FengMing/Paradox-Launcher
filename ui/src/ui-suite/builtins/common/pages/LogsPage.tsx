import '../styles/common.css';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, Terminal } from 'lucide-react';
import { Panel } from '@paradox/ui';
import { exportLogs } from '../lib/download';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
function LogsPage() {
  const { t } = useTranslation();
  const snapshot = useLauncherSnapshot(),
    actions = useLauncherActions(),
    logs = snapshot.logs.lines,
    busy = snapshot.activity !== null;
  const onClear = () => {
    void actions.logs.clear();
  };
  return (
    <Fragment data-ui-site="LogsPage-1">
      <div className="toolbar" data-ui-site="LogsPage-2">
        <div className="log-status" data-ui-site="LogsPage-3">
          <span className="status-dot" data-ui-site="LogsPage-4" />
          {busy ? t('logs.running') : t('logs.waiting')}
          <small data-ui-site="LogsPage-5">{t('logs.count', { count: logs.length })}</small>
        </div>
        <div className="button-group" data-ui-site="LogsPage-6">
          <button className="secondary" onClick={() => exportLogs(logs)} data-ui-site="LogsPage-7">
            <ArrowDownToLine size={16} data-ui-site="LogsPage-8" />
            {t('common.export')}
          </button>
          <button className="secondary" onClick={onClear} data-ui-site="LogsPage-9">
            {t('logs.clear')}
          </button>
        </div>
      </div>
      <Panel className="console" data-ui-site="LogsPage-10">
        <div className="console-header" data-ui-site="LogsPage-11">
          <Terminal size={16} data-ui-site="LogsPage-12" />
          <span data-ui-site="LogsPage-13">LAUNCHER CONSOLE</span>
          <div data-ui-site="LogsPage-14">
            <i data-ui-site="LogsPage-15" />
            <i data-ui-site="LogsPage-16" />
            <i data-ui-site="LogsPage-17" />
          </div>
        </div>
        {logs.length ? (
          logs.map((line, index) => (
            <div className={`log-line ${line.level}`} key={index} data-ui-site="LogsPage-18">
              <time data-ui-site="LogsPage-19">{line.time}</time>
              <b data-ui-site="LogsPage-20">{line.level.toUpperCase()}</b>
              <span data-ui-site="LogsPage-21">{line.message}</span>
            </div>
          ))
        ) : (
          <div className="console-empty" data-ui-site="LogsPage-22">
            <Terminal size={30} data-ui-site="LogsPage-23" />
            <p data-ui-site="LogsPage-24">{t('logs.emptyTitle')}</p>
            <small data-ui-site="LogsPage-25">{t('logs.emptyDescription')}</small>
          </div>
        )}
      </Panel>
    </Fragment>
  );
}
export default LogsPage;
