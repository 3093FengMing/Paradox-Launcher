import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, Search, Terminal } from 'lucide-react';
import { Button, Input, Panel, Select, Toggle, UiIdentity } from '@paradox/ui';
import { useLauncherActions, useLauncherSnapshot } from '@paradox/launcher';
import { exportLogs } from '../../common/lib/download';
import { displayLogLevels, displayLogRows, filterLogRows } from '../../common/lib/log-display';
import '../styles/logs.css';

export default function LogsPage() {
  const s = useLauncherSnapshot(), a = useLauncherActions(), { t } = useTranslation();
  const [query, setQuery] = useState(''), [level, setLevel] = useState(''), [follow, setFollow] = useState(true);
  const consoleRef = useRef<HTMLDivElement>(null);
  const lines = s.logs.lines;
  const rows = useMemo(() => displayLogRows(lines), [lines]);
  const levels = useMemo(() => displayLogLevels(lines), [lines]);
  const shown = useMemo(() => filterLogRows(rows, query, level), [rows, query, level]);
  useEffect(() => {
    const console = consoleRef.current;
    if (follow && console) console.scrollTop = console.scrollHeight;
  }, [shown, follow]);

  return <section className="logs-page modern-logs" aria-label={t('pages.logs.title')} data-ui-site="ModernLogs-root">
    <div className="logs-toolbar" data-ui-site="ModernLogs-toolbar">
      <label className="logs-search" data-ui-site="ModernLogs-search-label">
        <Search size={17} aria-hidden="true" data-ui-site="ModernLogs-search-icon"/>
        <Input type="search" value={query} aria-label={t('logDisplay.search')} placeholder={t('logDisplay.searchPlaceholder')}
          onChange={event => setQuery(event.target.value)} data-ui-site="ModernLogs-search"/>
      </label>
      <div className="logs-level-filter" data-ui-site="ModernLogs-level-field">
        <span data-ui-site="ModernLogs-level-label">{t('logDisplay.level')}</span>
        <Select value={level} aria-label={t('logDisplay.level')} onValueChange={value => setLevel(value ?? '')}
          options={[{ value: '', label: t('logDisplay.allLevels') }, ...levels.map(value => ({ value, label: value.toUpperCase() }))]}
          data-ui-site="ModernLogs-level"/>
      </div>
      <div className="logs-follow" data-ui-site="ModernLogs-follow-field">
        <span data-ui-site="ModernLogs-follow-label">{t('logDisplay.follow')}</span>
        <Toggle label={t('logDisplay.follow')} checked={follow} onChange={setFollow} data-ui-site="ModernLogs-follow"/>
      </div>
      <div className="logs-actions" data-ui-site="ModernLogs-actions">
        <Button className="secondary" disabled={!lines.length} onClick={() => exportLogs(lines)} data-ui-site="ModernLogs-export">
          <ArrowDownToLine size={16} aria-hidden="true" data-ui-site="ModernLogs-export-icon"/>{t('common.export')}
        </Button>
        <Button className="secondary" onClick={() => void a.logs.clear()} data-ui-site="ModernLogs-clear">{t('logs.clear')}</Button>
      </div>
    </div>
    <div className="logs-summary" data-ui-site="ModernLogs-summary">
      <p data-ui-site="ModernLogs-scope">{t('logDisplay.globalScope')}</p>
      <span role="status" aria-live="polite" data-ui-site="ModernLogs-count">{t('logDisplay.visibleCount', { count: shown.length, total: lines.length })}</span>
    </div>
    <Panel className="logs-panel" data-ui-site="ModernLogs-panel">
      <header className="logs-console-heading" data-ui-site="ModernLogs-heading">
        <Terminal size={16} aria-hidden="true" data-ui-site="ModernLogs-terminal"/>
        <span data-ui-site="ModernLogs-heading-title">{t('logDisplay.console')}</span>
        <small data-ui-site="ModernLogs-running">{t(s.activity ? 'logs.running' : 'logs.waiting')}</small>
      </header>
      <div className="logs-console" ref={consoleRef} role="region" tabIndex={0} aria-label={t('logDisplay.content')} data-ui-site="ModernLogs-console">
        {shown.length ? shown.map(({ key, line }) => <UiIdentity key={key} namespace="log" value={key}>
          <div className="logs-line" data-level={line.level} data-ui-site="ModernLogs-line">
            <time data-ui-site="ModernLogs-time">{line.time}</time>
            <b data-ui-site="ModernLogs-line-level">{line.level.toUpperCase()}</b>
            <span data-ui-site="ModernLogs-message">{line.message}</span>
          </div>
        </UiIdentity>) : <div className="logs-empty" data-ui-site="ModernLogs-empty">
          <Terminal size={28} aria-hidden="true" data-ui-site="ModernLogs-empty-icon"/>
          <p data-ui-site="ModernLogs-empty-title">{t(lines.length ? 'logDisplay.noMatches' : 'logs.emptyTitle')}</p>
          <small data-ui-site="ModernLogs-empty-description">{t(lines.length ? 'logDisplay.tryFilters' : 'logs.emptyDescription')}</small>
        </div>}
      </div>
    </Panel>
  </section>;
}
