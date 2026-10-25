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
  return (
    <>
      <div className="toolbar">
        <div className="log-status">
          <span className="status-dot" />
          {busy ? '任务进行中' : '等待下一次任务'}
          <small>{logs.length} 条记录 · 最多保留 500 条</small>
        </div>
        <div className="button-group">
          <button className="secondary" onClick={() => exportLogs(logs)}>
            <ArrowDownToLine size={16} />
            导出
          </button>
          <button className="secondary" onClick={onClear}>
            清空
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
            <p>尚无运行日志</p>
            <small>版本查询、安装与游戏输出会显示在这里。</small>
          </div>
        )}
      </Panel>
    </>
  );
}
