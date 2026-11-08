import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine, Search, Terminal } from 'lucide-react';
import { Button, Input, Panel, Toggle, UiIdentity } from '@paradox/ui';
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

  return <section className="logs-page immersive-logs" aria-label={t('pages.logs.title')} data-ui-site="ImmersiveLogs-root">
    <header className="logs-intro" data-ui-site="ImmersiveLogs-intro">
      <div data-ui-site="ImmersiveLogs-intro-copy">
        <h2 data-ui-site="ImmersiveLogs-title">{t('logDisplay.console')}</h2>
        <p data-ui-site="ImmersiveLogs-scope">{t('logDisplay.globalScope')}</p>
      </div>
      <div className="logs-actions" data-ui-site="ImmersiveLogs-actions">
        <Button className="secondary" disabled={!lines.length} onClick={() => exportLogs(lines)} data-ui-site="ImmersiveLogs-export">
          <ArrowDownToLine size={16} aria-hidden="true" data-ui-site="ImmersiveLogs-export-icon"/>{t('common.export')}
        </Button>
        <Button className="secondary" onClick={() => void a.logs.clear()} data-ui-site="ImmersiveLogs-clear">{t('logs.clear')}</Button>
      </div>
    </header>
    <div className="logs-workspace" data-ui-site="ImmersiveLogs-workspace">
      <aside className="logs-levels" aria-label={t('logDisplay.level')} data-ui-site="ImmersiveLogs-levels">
        <span className="logs-caption" data-ui-site="ImmersiveLogs-level-caption">{t('logDisplay.level')}</span>
        <Button className={`logs-level-choice ${level === '' ? 'selected' : ''}`} aria-pressed={level === ''}
          onClick={() => setLevel('')} data-ui-site="ImmersiveLogs-level-all">{t('logDisplay.allLevels')}</Button>
        {levels.map(value => <UiIdentity key={value} namespace="log-level" value={value}>
          <Button className={`logs-level-choice ${level === value ? 'selected' : ''}`} aria-pressed={level === value}
            onClick={() => setLevel(value)} data-ui-site="ImmersiveLogs-level-choice">{value.toUpperCase()}</Button>
        </UiIdentity>)}
      </aside>
      <div className="logs-main" data-ui-site="ImmersiveLogs-main">
        <div className="logs-toolbar" data-ui-site="ImmersiveLogs-toolbar">
          <label className="logs-search" data-ui-site="ImmersiveLogs-search-label">
            <Search size={17} aria-hidden="true" data-ui-site="ImmersiveLogs-search-icon"/>
            <Input type="search" value={query} aria-label={t('logDisplay.search')} placeholder={t('logDisplay.searchPlaceholder')}
              onChange={event => setQuery(event.target.value)} data-ui-site="ImmersiveLogs-search"/>
          </label>
          <div className="logs-follow" data-ui-site="ImmersiveLogs-follow-field">
            <span data-ui-site="ImmersiveLogs-follow-label">{t('logDisplay.follow')}</span>
            <Toggle label={t('logDisplay.follow')} checked={follow} onChange={setFollow} data-ui-site="ImmersiveLogs-follow"/>
          </div>
        </div>
        <Panel className="logs-panel" data-ui-site="ImmersiveLogs-panel">
          <header className="logs-console-heading" data-ui-site="ImmersiveLogs-heading">
            <Terminal size={16} aria-hidden="true" data-ui-site="ImmersiveLogs-terminal"/>
            <span data-ui-site="ImmersiveLogs-status">{t(s.activity ? 'logs.running' : 'logs.waiting')}</span>
            <small role="status" aria-live="polite" data-ui-site="ImmersiveLogs-count">{t('logDisplay.visibleCount', { count: shown.length, total: lines.length })}</small>
          </header>
          <div className="logs-console" ref={consoleRef} role="region" tabIndex={0} aria-label={t('logDisplay.content')} data-ui-site="ImmersiveLogs-console">
            {shown.length ? shown.map(({ key, line }) => <UiIdentity key={key} namespace="log" value={key}>
              <div className="logs-line" data-level={line.level} data-ui-site="ImmersiveLogs-line">
                <div className="logs-line-meta" data-ui-site="ImmersiveLogs-meta">
                  <time data-ui-site="ImmersiveLogs-time">{line.time}</time>
                  <b data-ui-site="ImmersiveLogs-line-level">{line.level.toUpperCase()}</b>
                </div>
                <span data-ui-site="ImmersiveLogs-message">{line.message}</span>
              </div>
            </UiIdentity>) : <div className="logs-empty" data-ui-site="ImmersiveLogs-empty">
              <Terminal size={28} aria-hidden="true" data-ui-site="ImmersiveLogs-empty-icon"/>
              <p data-ui-site="ImmersiveLogs-empty-title">{t(lines.length ? 'logDisplay.noMatches' : 'logs.emptyTitle')}</p>
              <small data-ui-site="ImmersiveLogs-empty-description">{t(lines.length ? 'logDisplay.tryFilters' : 'logs.emptyDescription')}</small>
            </div>}
          </div>
        </Panel>
      </div>
    </div>
  </section>;
}
